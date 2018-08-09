require('load-environment')
const fs = require('fs')
const request = require('request')
const p = require('./package.json')

const webtaskAPI = `https://sandbox.auth0-extend.com/api/cron/${process.env.WEBTASK_ID}`

request({
  url: `${webtaskAPI}/dappform-tasks-stats?key=${process.env.WEBTASK_TOKEN}`,
  method: 'PUT',
  json: {
    schedule: '40 * * * *'
  }
}, (err, res, body) => {
  console.log(err, body)
})
