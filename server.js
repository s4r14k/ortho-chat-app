'use strict';

const express = require('express');
const socketIO = require('socket.io');
const app = express ();

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const { Client } = require('pg');

// const client = new Client({
//   connectionString: process.env.DATABASE_URL,
//   ssl: {
//     rejectUnauthorized: false
//   }
// });

// client.connect();

// client.query('SELECT table_schema,table_name FROM information_schema.tables;', (err, res) => {
//   if (err) throw err;
//   for (let row of res.rows) {
//     console.log(JSON.stringify(row));
//   }
//   client.end();
// });

app.use(express.static(__dirname + '/public'));

const server = express()
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const io = socketIO(server);

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
  socket.on('messages', (body) => {
    io.emit('messages', body);
  });
});

setInterval(() => io.emit('time', new Date().toTimeString()), 1000);