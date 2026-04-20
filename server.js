const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3020;

app.use(express.static(__dirname));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`front-log-compare running at http://localhost:${PORT}`);
});
