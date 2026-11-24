const { join } = require('node:path')
module.exports = {
  extends: join(__dirname, 'electron-builder.yml'),
  appId: 'local.yogurt.coast',
  productName: 'Yogurt + Coast',
  publish: null,
  forceCodeSigning: true,
  electronDist: join(__dirname, '../node_modules/electron/dist'),
  mac: {
    identity: process.env.YOGURT_COAST_CERTIFICATE,
    notarize: false,
    timestamp: 'none',
    extendInfo: { CFBundleDisplayName: 'Yogurt + Coast' },
  },
}
