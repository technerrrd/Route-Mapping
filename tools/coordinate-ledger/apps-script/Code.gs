function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Coordinate Ledger")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Coordinate Ledger")
    .addItem("Set up ledger", "setupLedger")
    .addItem("Refresh current coordinates", "refreshCurrentCoordinates")
    .addItem("Sync GitHub now", "syncGitHub")
    .addToUi();
}
