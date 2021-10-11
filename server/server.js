import express from 'express'
import path from 'path'
import cors from 'cors'
import sockjs from 'sockjs'
import { renderToStaticNodeStream } from 'react-dom/server'
import React from 'react'
import axios from 'axios'

import cookieParser from 'cookie-parser'
import config from './config'
import Html from '../client/html'

const { readFile, writeFile, unlink } = require('fs').promises

require('colors')

let Root
try {
  // eslint-disable-next-line import/no-unresolved
  Root = require('../dist/assets/js/ssr/root.bundle').default
} catch {
  console.log('SSR not found. Please run "yarn run build:ssr"'.red)
}

let connections = []

const port = process.env.PORT || 8090
const server = express()

const setHeaders = (req, res, next) => {
  res.set('x-skillcrucial-user', '3d240521-5706-4272-a57e-5484ea9a2dcc')
  res.set('Access-Control-Expose-Headers', 'X-SKILLCRUCIAL-USER')
  next()
}

const middleware = [
  cors(),
  express.static(path.resolve(__dirname, '../dist/assets')),
  express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }),
  express.json({ limit: '50mb', extended: true }),
  cookieParser(),
  setHeaders
]

middleware.forEach((it) => server.use(it))

const addFileTo = `${__dirname}/data/test.json`
const getPlaceholder = 'https://jsonplaceholder.typicode.com/users'
const readFileUsers = () => readFile(addFileTo, { encoding: 'utf-8' })
const writeFileUsers = (usersFile) => writeFile(addFileTo, JSON.stringify(usersFile), 'utf-8')

server.get('/api/v1/users', async (req, res) => {
  const userList = await readFileUsers()
    .then((text) => {
      return JSON.parse(text)
    })
    .catch(async () => {
      const newUsers = await axios(getPlaceholder)
      await writeFileUsers(newUsers)
      return newUsers
    })
  res.json(userList)
})

server.post('/api/v1/users', async (req, res) => {
  const file = await readFileUsers()
    .then(async (text) => {
      const parsedText = JSON.parse(text)
      const lastUserId = parsedText[parsedText.length - 1].id
      const newBody = [...parsedText, { ...req.body, id: lastUserId + 1 }]
      await writeFileUsers(newBody)
      return { status: 'success', id: newBody[newBody.length - 1].id }
    })
    .catch(async () => {
      const user = [{ ...req.body, id: 1 }]
      await writeFileUsers(user)
      return { status: 'success', id: user.id }
    })
  res.json(file)
})

server.patch('/api/v1/users/:userId', async (req, res) => {
  const { userId } = req.params
  const updateBody = { ...req.body, id: +userId }
  const response = await readFileUsers()
    .then(async (text) => {
      const parsedText = JSON.parse(text)
      const updatedList = parsedText.map((obj) => {
        return obj.id === +userId ? { ...obj, ...updateBody } : obj
      })
      await writeFileUsers(updatedList)
      return { status: 'success', id: userId }
    })
    .catch(() => {
      return { status: 'No file', id: userId }
    })
  res.json(response)
})

server.delete('/api/v1/users/:userId', async (req, res) => {
  const { userId } = req.params
  const userList = await readFileUsers()
    .then(async (str) => {
      const parsedStr = JSON.parse(str)
      const filteredParsedStr = parsedStr.filter((obj) => {
        return +userId !== obj.id
      })
      await writeFileUsers(filteredParsedStr)
      return { status: 'success', id: userId }
    })
    .catch(() => {
      return { status: 'no file' }
    })
  res.json(userList)
})

server.delete('/api/v1/users', (req, res) => {
  unlink(addFileTo)
    .then(() => {
      res.json({ status: 'file was deleted' })
    })
    .catch(() => {
      res.json({ status: 'no file' })
    })
})

server.use('/api/', (req, res) => {
  res.status(404)
  res.end()
})

const [htmlStart, htmlEnd] = Html({
  body: 'separator',
  title: 'Skillcrucial'
}).split('separator')

server.get('/', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

server.get('/*', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

const app = server.listen(port)

if (config.isSocketsEnabled) {
  const echo = sockjs.createServer()
  echo.on('connection', (conn) => {
    connections.push(conn)
    conn.on('data', async () => {})

    conn.on('close', () => {
      connections = connections.filter((c) => c.readyState !== 3)
    })
  })
  echo.installHandlers(app, { prefix: '/ws' })
}
console.log(`Serving at http://localhost:${port}`)
