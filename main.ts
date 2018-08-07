import { v4 as uuid } from 'uuid'
import * as postmark from 'postmark'

const loadBlockstack = require('blockstack-anywhere')

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
  }
  catch (e) {
    console.log(`getFile failed`)
    console.error(e)
    return false
  }
  if (!json) {
    // console.info("Empty file. Form was probably deleted. " + path)
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
  weeklyReportRecipient: string,
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

type Results = [Form, string]

async function generateReports ():Promise<Results[]> {
  const formsBasic = await getForms()

  const forms:Form[] = await Promise.all(formsBasic.map(f =>getForm(f.uuid)))

  const toGenerate = forms
    .filter(form => !!form)
    .filter(form => form.created && form.uuid && form.name) // quick sanitize
    .filter(form => typeof form.weeklyReportRecipient === "string") // quick sanitize

  console.log('To generate '+ toGenerate.length)

  const reportsPromises = toGenerate
    .map(form => makeReport({privateKey:'', formUuid:form.uuid}))

  const reports = await Promise.all(reportsPromises)

  return toGenerate.map((f:Form,i:number) => <Results>[f, reports[i]])
}

module.exports = async (ctx:any, cb:Function) => {
  // Should be initialized at the beginning of your app. Before any calls to blockstack are made

  const blockstackObj:any = ctx.body
  console.assert(blockstackObj["blockstack"], 'missing .blockstack')
  console.assert(blockstackObj["blockstack-gaia-hub-config"], 'missing .blockstack-gaia-hub-config')
  console.assert(blockstackObj["blockstack-transit-private-key"], 'missing .blockstack-transit-private-key')

  // this is the data form your browser local storage - with the same keys
  blockstack = loadBlockstack(blockstackObj) // blockstack is defined on top of the module

  let reports:any[][]
  try {
    reports = await generateReports()
  }
  catch (e) {
    // res.statusCode = 500
    console.log(e)
  }

  console.assert(ctx.body['postmark-from'], 'missing from-email to be used with postmark')
  console.assert(ctx.body['postmark-key'], 'missing postmark api key')
  const client = new postmark.Client(ctx.body['postmark-key'], {})

  let results = []
  for (let [form, report] of reports) {
    const res = await client.sendEmail({
      "From": ctx.body['postmark-from'],
      To: form.weeklyReportRecipient,
      "Subject": "Weekly report",
      TextBody: report,
    })
    results.push(res)
  }

  const errors = results.filter(r => r.ErrorCode !== 0).slice(0, 20)
  if (errors.length > 0) {
    console.log('errors:', errors )
  }

  cb(null)
}
