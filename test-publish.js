require('load-environment')
const fs = require('fs')
const request = require('request')
const p = require('./package.json')

const webtaskAPI = `https://sandbox.auth0-extend.com/api/webtask/${process.env.WEBTASK_ID}`

request({
  url: `${webtaskAPI}/dappform-tasks-stats?key=${process.env.WEBTASK_TOKEN}`,
  method: 'PUT',
  json: {
    code: fs.readFileSync('index.js').toString(),
    secrets: {
      BLOCKSTACK: process.env.BLOCKSTACK,
      BLOCKSTACK_GAIA_HUB_CONFIG: process.env.BLOCKSTACK_GAIA_HUB_CONFIG,
      BLOCKSTACK_TRANSIT_PRIVATE_KEY: process.env.BLOCKSTACK_TRANSIT_PRIVATE_KEY,
      BLOCKSTACK_APP_PRIVATE_KEY: process.env.BLOCKSTACK_APP_PRIVATE_KEY,
      POSTMARK_TOKEN: process.env.POSTMARK_TOKEN,
      POSTMARK_FROM: process.env.POSTMARK_FROM,
      POSTMARK_TO: process.env.POSTMARK_TO
    },
    meta: {
      'wt-node-dependencies': JSON.stringify(p.dependencies).replace(/\^/g, '')
    }
  }
}, (err, res, body) => {
  console.log(err, body)
})
