import { v4 as uuid } from 'uuid'

let blockstack

// optional also work with the ENV variables set to BLOCKSTACK, BLOCKSTACK_GAIA_HUB_CONFIG and BLOCKSTACK_TRANSIT_PRIVATE_KEY
async function putFile(path: string, contents: Object, encrypt=true): Promise<void> {
  try {
    await blockstack.putFile(path, JSON.stringify(contents), {encrypt})
  }
  catch (e) {
    console.error(e)
  }
}

async function getFile(path: string): Promise<Object | Boolean> {
  let json
  let parsed
  try {
    json = await blockstack.getFile(path)
    console.log("Got", json)
  }
  catch (e) {
    console.log(`getFile failed`)
    console.error(e)
    return false
  }
  if (!json) {
    console.info("Empty file. Form was probably deleted. " + path)
    return false
  }
  try {
    parsed = JSON.parse(json)
  }
  catch (e) {
    console.log(`JSON.parse getFile contents failed`)
    console.error(e)
    return false
  }
  return parsed
}

interface Question {
  label: string,
  type: string,
  name: string,
  uuid: string,
  created: Date,
  modified: Date,
}

interface FormBasic {
  uuid: string,
  name: string
  authorPubKey: string

  created: Date,
  modified: Date,

  introText: string,
  confirmationText: string,
}

interface FormExpanded {
  questions: Question[],
}

interface Form extends FormBasic, FormExpanded {
  weeklyReportEnabled: boolean,
  weeklyLastSent: Date,
}

interface Submission {
  uuid: string,
  formUuid: string,
  created: Date,
  answers: Answer[]
}

interface Answer {
  questionUuid: string,
  name: string,
  value: string,
}

interface SubmissionMap {
  [key: string]: Submission
}

interface FormSubmissionMap {
  [key: string]: SubmissionMap
}

type WeeklyStatsRaw = {
  total: number,
  lastWeek: number,
}

type WeeklyStatsParams = {
  privateKey: string,
  formUuid: string,
}

function weeklyStats (submissions:Submission[]):WeeklyStatsRaw {
  const lastWeek = submissions
    .filter((s:Submission) => new Date().getTime() - new Date(s.created).getTime() < new Date().getTime() - 7 * 24 * 60 * 60 * 1000).length

  const total = submissions.length
  return {total, lastWeek}
}

function weeklyReportTextFormat (form:Form, report:WeeklyStatsRaw):string {
  return `
  Form '${form.name}' got ${report.lastWeek} new submissions last week, adding up to ${report.total} total.
  (uuid ${form.uuid})
   `.trim()
}

async function enableWeeklyReporting (uuid: string) {
}

async function makeReport (params:WeeklyStatsParams):Promise<string> {
  const map = await getFormSubmissions(params.formUuid)
  const stats = weeklyStats(Object.values(map))

  const form = await getForm(params.formUuid)
  const reportText = weeklyReportTextFormat(form, stats)

  return reportText
}

function sortSubmissions(submissions: Submission[]): FormSubmissionMap {
  return submissions.reduce((acc: FormSubmissionMap, cur: Submission) => {
    acc[cur.formUuid] = acc[cur.formUuid] || {} as SubmissionMap
    acc[cur.formUuid][cur.uuid] = cur
    return acc
  }, {} as FormSubmissionMap)
}

const formsListFile = 'forms.json'

function getSubmissionsPath(formUuid:string) {
  return `submissions/${formUuid}.json`
}

function getFormPath(formUuid: string) {
  return `forms/${formUuid}.json`
}

function getPublishPath(formUuid: string) {
  return `published/${formUuid}.json`
}

async function getFormsFile() {
  return await getFile(formsListFile)
}

async function getForms(): Promise<Partial<Form>[]> {
  const forms = await getFormsFile() as Partial<Form>[]
  if (!forms) await initForms()
  return forms || [] as Partial<Form>[]
}

async function initForms() {
  return await putFile(formsListFile, [])
}

// TODO: make the request concurrent for performance if needed
async function updateFormSubmissions(forms: FormSubmissionMap) {
  for (const formUuid in forms) {
    const newSubmissions = forms[formUuid]
    const submissionsPath = getSubmissionsPath(formUuid)

    const oldSubmissions = await getFile(submissionsPath) as SubmissionMap || {} as SubmissionMap

    console.debug(`form: ${formUuid} new submissions:`, newSubmissions)
    console.debug(`form: ${formUuid} old submissions:`, oldSubmissions)
    console.debug(`form: ${formUuid} old + new: `, { ...oldSubmissions, ...newSubmissions })
    await putFile(submissionsPath, { ...oldSubmissions, ...newSubmissions })
  }
}

async function updateSubmissionsFromBench(submissions: Submission[]) {
  return updateFormSubmissions(sortSubmissions(submissions))
}

async function getFormSubmissions(formUuid: string): Promise<SubmissionMap> {
  return await getFile(getSubmissionsPath(formUuid)) as SubmissionMap || {} as SubmissionMap
}

async function getForm(formUuid: string): Promise<Form | undefined> {
  return await getFile(getFormPath(formUuid)) as Form || undefined
}

function publishForm(form:Form):Promise<void> {
  return putFile(getPublishPath(form.uuid), form, false)
}

async function addFormToList (form:Form) {
  const forms = await getForms()
  await putFile(formsListFile, [...forms, form])
}

async function saveForm(form:Form) {
  await putFile(getFormPath(form.uuid), form)
}

function createForm(form:Form) {
  return Promise.all([
    putFile(getFormPath(form.uuid), form),
    publishForm(form),
    addFormToList(form)
  ])
}

function createDummySubmission(formUuid:string) {
  return {
    uuid: uuid(),
    formUuid,
    created: new Date(),
    answers: [{ questionUuid: '12345', name: 'privacy', value: 'IS GREAT' } as Answer]
  } as Submission
}

async function deleteFormSubmissions(formUuid:string) {
  return await putFile(getSubmissionsPath(formUuid), {})
}

async function removeFormFromList(formUuid:string) {
  const forms = await getForms()
  await putFile(formsListFile, forms.filter(f => f.uuid !== formUuid))
}

async function unpublishForm(formUuid:string) {
  return await putFile(getPublishPath(formUuid), {})
}

async function deleteForm(formUuid: string) {
  await unpublishForm(formUuid)
  await deleteFormSubmissions(formUuid)
  await removeFormFromList(formUuid)
  await putFile(getFormPath(formUuid), {})
}

async function generateReports () {
  const forms = await getForms()

  const reportsPromises = forms
    .filter(form => form.created && form.uuid && form.name) // quick sanitize
    .map(f => f.uuid)
    .map(uuid => makeReport({privateKey:'', formUuid:uuid}))

  const reports = await Promise.all(reportsPromises)
  return reports
}

module.exports = async (ctx:any, cb:Function) => {
  // Should be initialized at the beginning of your app. Before any calls to blockstack are made
  const loadBlockstack = require('blockstack-anywhere')
  blockstack = require('blockstack')

  // this is the data form your browser local storage - with the same keys
  loadBlockstack({
    "blockstack": "{\"username\":\"hax.id.blockstack\",\"profile\":{\"@type\":\"Person\",\"@context\":\"http://schema.org\",\"name\":\"jules\",\"description\":\"I are coffee\",\"apps\":{\"http://127.0.0.1:8080\":\"https://gaia.blockstack.org/hub/14ktrFjBTrQhmvZYdEgVZPEvceo6uKiyLZ/\",\"https://dappform.takectrl.io\":\"https://gaia.blockstack.org/hub/1B8dUTGqW6XNt1ToV9YottvcMHGSg3z2WR/\",\"https://app.travelstack.club\":\"https://gaia.blockstack.org/hub/1EP1NLEuqT9eQEH64ntLh4f6FNNYAqGhpA/\"}},\"decentralizedID\":\"did:btc-addr:1P16yu4phxocxqfwtTGWvceDk9D9nfQuTM\",\"identityAddress\":\"1P16yu4phxocxqfwtTGWvceDk9D9nfQuTM\",\"appPrivateKey\":\"36537b6ab19ea5a0eb0806890b3c4d7724d005ffb4f74a5f8dd08660acdf9588\",\"coreSessionToken\":null,\"authResponseToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NksifQ.eyJqdGkiOiIyNzljNGM3Yy00ZjJhLTRmZGYtODI3Yi1kNGM4MWRiMDU4NDIiLCJpYXQiOjE1MzMyMDc5ODIsImV4cCI6MTUzNTg4NjM4MiwiaXNzIjoiZGlkOmJ0Yy1hZGRyOjFQMTZ5dTRwaHhvY3hxZnd0VEdXdmNlRGs5RDluZlF1VE0iLCJwcml2YXRlX2tleSI6IjdiMjI2OTc2MjIzYTIyMzA2NDY1NjQzMTYxNjY2MjY0MzU2NTYxNjY2MzY0NjM2MjM3NjMzODM2NjEzODMzMzIzMjY0NjIzNjM1MzQ2MTIyMmMyMjY1NzA2ODY1NmQ2NTcyNjE2YzUwNGIyMjNhMjIzMDMzMzYzNjY0MzY2MjYyMzg2MTMzMzQzODMyMzYzMzMzNjMzMTMwMzkzODYxMzczNTMyMzEzNjMwNjIzNTM0MzQ2MjMwMzAzMDY2NjQzOTMzNjEzNTM1NjMzODM0NjUzNjM1MzIzNzMxMzczMjYxNjEzOTMxNjIzNDMxNjM2NTM2MzIyMjJjMjI2MzY5NzA2ODY1NzI1NDY1Nzg3NDIyM2EyMjY1MzEzMzY0MzAzNDY1MzE2NjM2NjY2NDM1MzYzOTM1NjI2NjM1MzczNDMyNjEzNTMzNjQzNjM4Mzg2NDYyMzE2NDM0MzU2NTM5MzQzOTYxMzUzOTMxMzM2MjMzNjMzNDY0MzEzNDM5NjIzOTY1MzA2MzMzNjM2MzM0MzU2MTMwMzg2MjM1Mzg2NTMzMzQzNDM4Mzk2MzMyNjY2MzY0MzkzMDM2MzY2NTM2MzY2NDY1MzEzNTM4NjEzNTY0MzgzMTM0MzM2NDM0MzMzNzMxMzMzMDY2MzM2NDM4MzkzMDM0NjUzOTY0NjYzMjY0MzIzNzY2MzQzMDM4MzczMDY0NjQ2NDYzMzYzNjY2MzUzMDYzMzUzMTM0MzgzNzYzMzIzODMzMzQzMjM1MzIzNjM5MzIzNDMzMzMzMjM2MzgzOTM1MjIyYzIyNmQ2MTYzMjIzYTIyNjE2MTM0NjQ2NjYyNjEzNjMwNjU2MzMzNjEzOTY0NjYzNDMxMzMzNzY2MzEzMDYzNjUzOTMzNjI2MzY0MzczMTM5NjQzMDY0MzgzMjM0MzczMjM5MzczNzM1Mzc2NDM0NjEzNDMwMzg2MjYyNjM2NjM4MzgzMTM1NjM2NTMwNjMyMjJjMjI3NzYxNzM1Mzc0NzI2OTZlNjcyMjNhNzQ3Mjc1NjU3ZCIsInB1YmxpY19rZXlzIjpbIjAzYjEzNTgzZWU5NmFkZWFhZDlhYjIwYjUyNzhiNjc5YjRiNjk4MjE0M2M2OWFjZWFjZTI1Njk3Yzg2NWUxYmYyOCJdLCJwcm9maWxlIjpudWxsLCJ1c2VybmFtZSI6ImhheC5pZC5ibG9ja3N0YWNrIiwiY29yZV90b2tlbiI6bnVsbCwiZW1haWwiOm51bGwsInByb2ZpbGVfdXJsIjoiaHR0cHM6Ly9nYWlhLmJsb2Nrc3RhY2sub3JnL2h1Yi8xUDE2eXU0cGh4b2N4cWZ3dFRHV3ZjZURrOUQ5bmZRdVRNL3Byb2ZpbGUuanNvbiIsImh1YlVybCI6Imh0dHBzOi8vaHViLmJsb2Nrc3RhY2sub3JnIiwidmVyc2lvbiI6IjEuMi4wIn0.Qi6136MBm12ZGwaB8uHSoBf70CUCkGxygYBSCAGsk9a6IgCW6j-2IT8FO-J09l2mG2fVKhTz6VWOfhdeXg7vxA\",\"hubUrl\":\"https://hub.blockstack.org\"}",
    "blockstack-gaia-hub-config": "{\"url_prefix\":\"https://gaia.blockstack.org/hub/\",\"address\":\"14ktrFjBTrQhmvZYdEgVZPEvceo6uKiyLZ\",\"token\":\"eyJwdWJsaWNrZXkiOiIwMzA0ZWI1OWY5ZDMzYWNkYzQ2ODI1YzE2MDQwNWIxMTU0Y2NhYmZmZjIyNmZiNzc3ZTRjZTVkZjRjOGY4Y2FjZDQiLCJzaWduYXR1cmUiOiIzMDQ1MDIyMTAwYmQ2Y2Y4NzZmMzM0NDJlNGJhNzg3Y2RmZWI3M2JlNWUzNGQ3ZmRjYzkxMTNmZGY2NWU3MDNhYjQ1NWZkNTkwNzAyMjAwZTQ0YmZjMmJiM2NmODlmMDBmODlmZGYwODI2NzAwOTI5MTkzNjhhNmQwZDQ0NmEzZmFmMjM3NjhjODA1ZTJlIn0=\",\"server\":\"https://hub.blockstack.org\"}",
    "blockstack-transit-private-key": "880c0e0fd6c3b6b7dba31f2124fe7b40b5a3b02fd680925d0f735edfeb681a00"
  })

  let txt:string
  try {
    const reports = await generateReports()
    txt = reports.join('\n')
  //   res.statusCode = 200
  }
  catch (e) {
    // res.statusCode = 500
    console.log(e)
  }
  // res.end(txt)
  cb(null, {status: txt})
}