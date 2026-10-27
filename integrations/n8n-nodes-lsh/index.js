'use strict';

// n8n loads the files listed under "n8n" in package.json; this is for require().
module.exports = {
  ...require('./credentials/LshApi.credentials'),
  ...require('./nodes/Lsh/Lsh.node'),
  ...require('./nodes/LshTrigger/LshTrigger.node'),
};
