#!/usr/bin/env node
// Only the isolated E2E profile calls this stand-in for the Coast bridge.
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const root = process.env.YOGURT_FAKE_COAST_FIXTURE
if (args.includes('cover')) {
  const range = args[args.indexOf('--tr') + 1]
  fs.appendFileSync(path.join(root, 'ranges'), range + '\n')
  if (!fs.existsSync(path.join(root, 'ready'))) process.exit(1)
  const [from] = range.split('|')
  const id = new Date(from).getTime() / 1000
  const frames = [{ frame_id: id, timestamp: from, application: 'Slides', title: 'Launch dates', ocr_text: 'Product launch dates February March' }]
  console.log(JSON.stringify({ frames, selected_count: 1, total_count: 1 }))
} else if (args.includes('image')) {
  const out = path.join(process.env.TMPDIR, 'fixture.png')
  fs.copyFileSync(path.join(__dirname, '../../resources/tray-titled@2x.png'), out)
  console.log(out)
} else process.exit(1)
