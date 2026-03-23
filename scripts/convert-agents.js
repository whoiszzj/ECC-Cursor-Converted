const {
  DEFAULT_CONFIG_PATH,
  DEFAULT_DESTINATION_ROOT,
  DEFAULT_IGNORE_CONFIG_PATH,
  DEFAULT_SOURCE_ROOT,
  convertAgents,
} = require("./lib/ecc-to-cursor");

function readOption(flag, fallbackValue) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return fallbackValue;
  }

  return process.argv[index + 1];
}

const sourceRoot = process.argv[2] || DEFAULT_SOURCE_ROOT;
const destinationRoot = process.argv[3] || DEFAULT_DESTINATION_ROOT;
const configPath = readOption("--config", DEFAULT_CONFIG_PATH);
const ignoreConfigPath = readOption("--ignore-config", DEFAULT_IGNORE_CONFIG_PATH);
const clean = process.argv.includes("--clean");
const converted = convertAgents({
  sourceRoot,
  destinationRoot,
  configPath,
  ignoreConfigPath,
  clean,
});

console.log(JSON.stringify({
  sourceRoot,
  destinationRoot,
  configPath,
  ignoreConfigPath,
  count: converted.length,
}, null, 2));
