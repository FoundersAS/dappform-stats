"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bodyParser = require("body-parser");
const postmark = require("postmark");
const cors = require("cors");
const dappform_forms_api_1 = require("dappform-forms-api");
const express = require("express");
const wt = require('webtask-tools');
const loadBlockstack = require('blockstack-anywhere');
function initBlockstack(context) {
    process.env.BLOCKSTACK = context.secrets.BLOCKSTACK;
    process.env.BLOCKSTACK_GAIA_HUB_CONFIG = context.secrets.BLOCKSTACK_GAIA_HUB_CONFIG;
    process.env.BLOCKSTACK_TRANSIT_PRIVATE_KEY = context.secrets.BLOCKSTACK_TRANSIT_PRIVATE_KEY;
    loadBlockstack();
}
const oneWeekinTime = 7 * 24 * 60 * 60 * 1000;
function weeklyStats(submissions) {
    const lastWeek = submissions.filter((s) => {
        return new Date().getTime() - new Date(s.created).getTime() < new Date().getTime() - oneWeekinTime;
    }).length;
    const total = submissions.length;
    return { total, lastWeek };
}
function weeklyReportTextFormat(form, report) {
    return `
  Form '${form.name}' got ${report.lastWeek} new submissions last week, adding up to ${report.total} total.
  (uuid ${form.uuid})
   `.trim();
}
// async function enableWeeklyReporting(uuid: string) {
// }
async function makeReport(params) {
    const map = await dappform_forms_api_1.getFormSubmissions(params.formUuid);
    const stats = weeklyStats(Object.values(map));
    const form = await dappform_forms_api_1.getForm(params.formUuid);
    const reportText = weeklyReportTextFormat(form, stats);
    return reportText;
}
async function generateReports() {
    const formsBasic = await dappform_forms_api_1.getForms();
    const forms = await Promise.all(formsBasic.map((f) => dappform_forms_api_1.getForm(f.uuid)));
    const toGenerate = forms
        .filter((form) => !!form)
        .filter((form) => form.created && form.uuid && form.name); // quick sanitize
    console.log('To generate ' + toGenerate.length);
    const reportsPromises = toGenerate
        .map((form) => makeReport({ privateKey: '', formUuid: form.uuid }));
    const reports = await Promise.all(reportsPromises);
    return toGenerate.map((f, i) => {
        return [f, reports[i]];
    });
}
const app = express();
app.use(cors());
app.use(bodyParser.json());
const asyncMiddleware = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
// Post to a bench must provide public key + data blob
app.get('/', (req, res) => {
    initBlockstack(req.webtaskContext);
    const secrets = req.webtaskContext.secrets;
    generateReports().then((reports) => {
        const client = new postmark.Client(secrets.POSTMARK_TOKEN, {});
        const emails = [];
        for (const [form, report] of reports) {
            const email = client.sendEmail({
                From: secrets.POSTMARK_FROM,
                Subject: 'Weekly report',
                TextBody: report,
                To: secrets.POSTMARK_TO,
            });
            emails.push(email);
        }
        return Promise.all(emails);
    }).then((results) => {
        const errors = results.filter((r) => r.ErrorCode !== 0).slice(0, 20);
        if (errors.length > 0) {
            console.log('postmark errors: ', errors);
        }
        res.send('ok');
    }).catch((e) => {
        console.error(e);
        res.status(500).send(e);
    });
});
module.exports = wt.fromExpress(app);
