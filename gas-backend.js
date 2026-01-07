// Google Apps Script Code
// Deploy this as a Web App: 
// 1. Create a new Google Spreadsheet.
// 2. Extensions > Apps Script.
// 3. Paste this code.
// 4. Deploy > New Deployment > Select type: Web App.
// 5. Execute as: Me.
// 6. Who has access: Anyone.

function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

        // Expecting: image (base64), studentId, studentName, timestamp
        const imageBase64 = data.image;
        const studentId = data.studentId;
        const studentName = data.studentName;
        const timestamp = new Date(); // Use server time or client time

        // Save image to Drive
        // 1. Get/Create folder (optional, or just root)
        const folderName = "Attendance_Selfies";
        let folder;
        const folders = DriveApp.getFoldersByName(folderName);
        if (folders.hasNext()) {
            folder = folders.next();
        } else {
            folder = DriveApp.createFolder(folderName);
        }

        // 2. Create file
        // Remove header if present (e.g., "data:image/png;base64,")
        const contentType = imageBase64.substring(5, imageBase64.indexOf(';'));
        const bytes = Utilities.base64Decode(imageBase64.substr(imageBase64.indexOf('base64,') + 7));
        const blob = Utilities.newBlob(bytes, contentType, `${studentId}_${timestamp.getTime()}.png`);
        const file = folder.createFile(blob);
        const fileUrl = file.getUrl();

        // Append to Sheet
        sheet.appendRow([timestamp, studentId, studentName, fileUrl, "Present"]);

        return ContentService.createTextOutput(JSON.stringify({ status: "success", fileUrl: fileUrl }))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function doGet(e) {
    // Return student list if needed
    return ContentService.createTextOutput(JSON.stringify({ status: "ready" })).setMimeType(ContentService.MimeType.JSON);
}
