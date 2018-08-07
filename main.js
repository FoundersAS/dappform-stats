"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const uuid_1 = require("uuid");
const postmark = require("postmark");
const loadBlockstack = require('blockstack-anywhere');
let blockstack;
// optional also work with the ENV variables set to BLOCKSTACK, BLOCKSTACK_GAIA_HUB_CONFIG and BLOCKSTACK_TRANSIT_PRIVATE_KEY
async function putFile(path, contents, encrypt = true) {
    try {
        await blockstack.putFile(path, JSON.stringify(contents), { encrypt });
    }
    catch (e) {
        console.error(e);
    }
}
async function getFile(path) {
    let json;
    let parsed;
    try {
        json = await blockstack.getFile(path);
    }
    catch (e) {
        console.log(`getFile failed`);
        console.error(e);
        return false;
    }
    if (!json) {
        // console.info("Empty file. Form was probably deleted. " + path)
        return false;
    }
    try {
        parsed = JSON.parse(json);
    }
    catch (e) {
        console.log(`JSON.parse getFile contents failed`);
        console.error(e);
        return false;
    }
    return parsed;
}
function weeklyStats(submissions) {
    const lastWeek = submissions
        .filter((s) => new Date().getTime() - new Date(s.created).getTime() < new Date().getTime() - 7 * 24 * 60 * 60 * 1000).length;
    const total = submissions.length;
    return { total, lastWeek };
}
function weeklyReportTextFormat(form, report) {
    return `
  Form '${form.name}' got ${report.lastWeek} new submissions last week, adding up to ${report.total} total.
  (uuid ${form.uuid})
   `.trim();
}
async function enableWeeklyReporting(uuid) {
}
async function makeReport(params) {
    const map = await getFormSubmissions(params.formUuid);
    const stats = weeklyStats(Object.values(map));
    const form = await getForm(params.formUuid);
    const reportText = weeklyReportTextFormat(form, stats);
    return reportText;
}
function sortSubmissions(submissions) {
    return submissions.reduce((acc, cur) => {
        acc[cur.formUuid] = acc[cur.formUuid] || {};
        acc[cur.formUuid][cur.uuid] = cur;
        return acc;
    }, {});
}
const formsListFile = 'forms.json';
function getSubmissionsPath(formUuid) {
    return `submissions/${formUuid}.json`;
}
function getFormPath(formUuid) {
    return `forms/${formUuid}.json`;
}
function getPublishPath(formUuid) {
    return `published/${formUuid}.json`;
}
async function getFormsFile() {
    return await getFile(formsListFile);
}
async function getForms() {
    const forms = await getFormsFile();
    if (!forms)
        await initForms();
    return forms || [];
}
async function initForms() {
    return await putFile(formsListFile, []);
}
// TODO: make the request concurrent for performance if needed
async function updateFormSubmissions(forms) {
    for (const formUuid in forms) {
        const newSubmissions = forms[formUuid];
        const submissionsPath = getSubmissionsPath(formUuid);
        const oldSubmissions = await getFile(submissionsPath) || {};
        console.debug(`form: ${formUuid} new submissions:`, newSubmissions);
        console.debug(`form: ${formUuid} old submissions:`, oldSubmissions);
        console.debug(`form: ${formUuid} old + new: `, Object.assign({}, oldSubmissions, newSubmissions));
        await putFile(submissionsPath, Object.assign({}, oldSubmissions, newSubmissions));
    }
}
async function updateSubmissionsFromBench(submissions) {
    return updateFormSubmissions(sortSubmissions(submissions));
}
async function getFormSubmissions(formUuid) {
    return await getFile(getSubmissionsPath(formUuid)) || {};
}
async function getForm(formUuid) {
    return await getFile(getFormPath(formUuid)) || undefined;
}
function publishForm(form) {
    return putFile(getPublishPath(form.uuid), form, false);
}
async function addFormToList(form) {
    const forms = await getForms();
    await putFile(formsListFile, [...forms, form]);
}
async function saveForm(form) {
    await putFile(getFormPath(form.uuid), form);
}
function createForm(form) {
    return Promise.all([
        putFile(getFormPath(form.uuid), form),
        publishForm(form),
        addFormToList(form)
    ]);
}
function createDummySubmission(formUuid) {
    return {
        uuid: uuid_1.v4(),
        formUuid,
        created: new Date(),
        answers: [{ questionUuid: '12345', name: 'privacy', value: 'IS GREAT' }]
    };
}
async function deleteFormSubmissions(formUuid) {
    return await putFile(getSubmissionsPath(formUuid), {});
}
async function removeFormFromList(formUuid) {
    const forms = await getForms();
    await putFile(formsListFile, forms.filter(f => f.uuid !== formUuid));
}
async function unpublishForm(formUuid) {
    return await putFile(getPublishPath(formUuid), {});
}
async function deleteForm(formUuid) {
    await unpublishForm(formUuid);
    await deleteFormSubmissions(formUuid);
    await removeFormFromList(formUuid);
    await putFile(getFormPath(formUuid), {});
}
async function generateReports() {
    const formsBasic = await getForms();
    const forms = await Promise.all(formsBasic.map(f => getForm(f.uuid)));
    const toGenerate = forms
        .filter(form => !!form)
        .filter(form => form.created && form.uuid && form.name) // quick sanitize
        .filter(form => typeof form.weeklyReportRecipient === "string"); // quick sanitize
    console.log('To generate ' + toGenerate.length);
    const reportsPromises = toGenerate
        .map(form => makeReport({ privateKey: '', formUuid: form.uuid }));
    const reports = await Promise.all(reportsPromises);
    return toGenerate.map((f, i) => [f, reports[i]]);
}
module.exports = async (ctx, cb) => {
    // Should be initialized at the beginning of your app. Before any calls to blockstack are made
    const blockstackObj = ctx.body;
    console.assert(blockstackObj["blockstack"], 'missing .blockstack');
    console.assert(blockstackObj["blockstack-gaia-hub-config"], 'missing .blockstack-gaia-hub-config');
    console.assert(blockstackObj["blockstack-transit-private-key"], 'missing .blockstack-transit-private-key');
    // this is the data form your browser local storage - with the same keys
    blockstack = loadBlockstack(blockstackObj); // blockstack is defined on top of the module
    let reports;
    try {
        reports = await generateReports();
    }
    catch (e) {
        // res.statusCode = 500
        console.log(e);
    }
    console.assert(ctx.body['postmark-from'], 'missing from-email to be used with postmark');
    console.assert(ctx.body['postmark-key'], 'missing postmark api key');
    const client = new postmark.Client(ctx.body['postmark-key'], {});
    let results = [];
    for (let [form, report] of reports) {
        const res = await client.sendEmail({
            "From": ctx.body['postmark-from'],
            To: form.weeklyReportRecipient,
            "Subject": "Weekly report",
            TextBody: report,
        });
        results.push(res);
    }
    const errors = results.filter(r => r.ErrorCode !== 0).slice(0, 20);
    if (errors.length > 0) {
        console.log('errors:', errors);
    }
    cb(null);
};
