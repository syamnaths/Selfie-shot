function doPost(e) {
    const lock = LockService.getScriptLock();
    // Wait for up to 30 seconds for other processes to finish.
    const hasLock = lock.tryLock(30000);

    if (!hasLock) {
        return ContentService.createTextOutput("Error: Server is busy, please try again.");
    }

    try {
        const data = JSON.parse(e.postData.contents);
        const studentId = data.studentId.toString().trim();
        const imageBase64 = data.image; // Expecting base64 string

        // CONFIGURATION
        const FOLDER_ID = "1V4uFTdIWa-ue3z7d1JUe8daUApNIiSc2";
        const SHEET_NAME = "Sheet1";

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName(SHEET_NAME);
        if (!sheet) throw new Error("Sheet not found");

        const dataRange = sheet.getDataRange();
        const values = dataRange.getValues();
        const headers = values[0]; // Row 1

        // 1. Find Student Row
        let rowIndex = -1;
        for (let i = 1; i < values.length; i++) {
            if (values[i][1].toString().trim() === studentId) {
                rowIndex = i;
                break;
            }
        }

        if (rowIndex === -1) {
            return ContentService.createTextOutput("Error: Student ID not found");
        }

        // 2. Handle Date Column (STRICT CHECK)
        const today = new Date();
        const TIMEZONE = ss.getSpreadsheetTimeZone();
        const dateString = Utilities.formatDate(today, TIMEZONE, "M/d/yyyy");

        let dateColIndex = -1;

        for (let j = 0; j < headers.length; j++) {
            let cellVal = headers[j];
            let cellDateStr = "";

            if (Object.prototype.toString.call(cellVal) === '[object Date]') {
                cellDateStr = Utilities.formatDate(cellVal, TIMEZONE, "M/d/yyyy");
            } else {
                cellDateStr = cellVal.toString().trim();
            }

            if (cellDateStr === dateString) {
                dateColIndex = j;
                break;
            }
        }

        if (dateColIndex === -1) {
            dateColIndex = headers.length;
            sheet.getRange(1, dateColIndex + 1).setValue(dateString); // Write string
        }

        // 3. Mark Attendance
        sheet.getRange(rowIndex + 1, dateColIndex + 1).setValue("Present");

        // 4. Handle Image logic (Replace old image)
        const LINK_COL_INDEX = 2; // Column C
        const currentLink = values[rowIndex][LINK_COL_INDEX];

        if (currentLink && currentLink.includes("drive.google.com")) {
            try {
                const fileId = currentLink.match(/[-\w]{25,}/);
                if (fileId) {
                    DriveApp.getFileById(fileId[0]).setTrashed(true);
                }
            } catch (err) {
                Logger.log("Err deleting: " + err);
            }
        }

        // Save New Image
        const contentType = imageBase64.substring(5, imageBase64.indexOf(';'));
        const bytes = Utilities.base64Decode(imageBase64.substr(imageBase64.indexOf('base64,') + 7));
        const blob = Utilities.newBlob(bytes, contentType, studentId + "_" + dateString + ".jpg");

        const folder = DriveApp.getFolderById(FOLDER_ID);
        const file = folder.createFile(blob);

        sheet.getRange(rowIndex + 1, LINK_COL_INDEX + 1).setValue(file.getUrl());

        return ContentService.createTextOutput("Success");

    } catch (f) {
        return ContentService.createTextOutput("Error: " + f.toString());
    } finally {
        lock.releaseLock();
    }
}
