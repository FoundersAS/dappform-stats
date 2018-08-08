import * as bodyParser from 'body-parser'
import * as postmark from 'postmark'
import { v4 as uuid } from 'uuid'

import * as cors from 'cors'
import { Form, getForm, getForms, getFormSubmissions, Submission } from 'dappform-forms-api'
import * as express from 'express'

const wt = require('webtask-tools')

const loadBlockstack = require('blockstack-anywhere')

function initBlockstack(context: any) {
  process.env.BLOCKSTACK = context.secrets.BLOCKSTACK
  process.env.BLOCKSTACK_GAIA_HUB_CONFIG = context.secrets.BLOCKSTACK_GAIA_HUB_CONFIG
  process.env.BLOCKSTACK_TRANSIT_PRIVATE_KEY = context.secrets.BLOCKSTACK_TRANSIT_PRIVATE_KEY
  loadBlockstack()
}

interface IWeeklyStatsRaw {
  total: number,
  lastWeek: number,
}

interface IWeeklyStatsParams {
  privateKey: string,
  formUuid: string,
}

const oneWeekinTime = 7 * 24 * 60 * 60 * 1000

function weeklyStats(submissions: Submission[]): IWeeklyStatsRaw {
  const lastWeek = submissions.filter((s: Submission) => {
    return new Date().getTime() - new Date(s.created).getTime() < new Date().getTime() - oneWeekinTime
  }).length

  const total = submissions.length
  return { total, lastWeek }
}

function weeklyReportTextFormat(form: Form, report: IWeeklyStatsRaw): string {
  return `
  Form '${form.name}' got ${report.lastWeek} new submissions last week, adding up to ${report.total} total.
  (uuid ${form.uuid})
   `.trim()
}

// async function enableWeeklyReporting(uuid: string) {
// }

async function makeReport(params: IWeeklyStatsParams): Promise<string> {
  const map = await getFormSubmissions(params.formUuid)
  const stats = weeklyStats(Object.values(map))

  const form = await getForm(params.formUuid)
  const reportText = weeklyReportTextFormat(form, stats)

  return reportText
}

type Results = [Form, string]

async function generateReports(): Promise<Results[]> {
  const formsBasic = await getForms()

  const forms: Form[] = await Promise.all(formsBasic.map((f: Form) => getForm(f.uuid)))

  const toGenerate = forms
    .filter((form: Form) => !!form)
    .filter((form: Form) => form.created && form.uuid && form.name) // quick sanitize

  console.log('To generate ' + toGenerate.length)

  const reportsPromises = toGenerate
    .map((form: Form) => makeReport({privateKey: '', formUuid: form.uuid}))

  const reports = await Promise.all(reportsPromises)

  return toGenerate.map((f: Form, i: number) => <Results>[f, reports[i]])
}

const app = express()

app.use(cors())
app.use(bodyParser.json())

const asyncMiddleware = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// Post to a bench must provide public key + data blob
app.get('/', (req: any, res) => {
  initBlockstack(req.webtaskContext)
  const secrets = req.webtaskContext.secrets

  console.log(secrets)

  generateReports().then((reports: any[][]) => {
    const client = new postmark.Client(secrets.POSTMARK_TOKEN, {})
    const emails = []

    for (const [form, report] of reports) {
      const email = client.sendEmail({
        From: secrets.POSTMARK_FROM,
        Subject: 'Weekly report',
        TextBody: report,
        To: secrets.POSTMARK_TO,
      })
      emails.push(email)
    }

    return Promise.all(emails)
  }).then((results) => {
    console.log('email results: ', results)

    const errors = results.filter((r) => r.ErrorCode !== 0).slice(0, 20)

    if (errors.length > 0) {
      console.log('postmark errors: ', errors)
    }

    console.log('done')
    res.send('ok')
  }).catch((e) => {
    console.error(e)
    res.status(500).send(e)
  })
})

module.exports = wt.fromExpress(app)
