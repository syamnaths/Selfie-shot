function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);
        const studentId = data.studentId.toString().trim();
        const imageBase64 = data.image; // Expecting base64 string

        // CONFIGURATION
        const FOLDER_ID = "1V4uFTdIWa-ue3z7d1JUe8daUApNIiSc2"; // Updated by user
        const SHEET_NAME = "Sheet1";

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName(SHEET_NAME);
        if (!sheet) throw new Error("Sheet not found");

        const dataRange = sheet.getDataRange();
        const values = dataRange.getValues();
        const headers = values[0];

        // 1. Find Student Row
        // Assuming ID is in Column B (index 1) based on user prompt "Name ID Date Link"
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

        // 2. Handle Date Column (Robust Check)
        const today = new Date();
        const dateString = (today.getMonth() + 1) + '/' + today.getDate() + '/' + today.getFullYear();

        let dateColIndex = -1;

        // Check headers safely
        for (let j = 0; j < headers.length; j++) {
            let cellVal = headers[j];
            let cellDateStr = "";

            if (Object.prototype.toString.call(cellVal) === '[object Date]') {
                // It's a date object, format it
                cellDateStr = (cellVal.getMonth() + 1) + '/' + cellVal.getDate() + '/' + cellVal.getFullYear();
            } else {
                // It's a string or other
                cellDateStr = cellVal.toString();
            }

            if (cellDateStr === dateString) {
                dateColIndex = j;
                break;
            }
        }

        // If still not found, create new column
        if (dateColIndex === -1) {
            dateColIndex = headers.length;
            sheet.getRange(1, dateColIndex + 1).setValue(dateString);
        }

        // 3. Mark Attendance
        sheet.getRange(rowIndex + 1, dateColIndex + 1).setValue("Present");

        // 4. Handle Image logic (Replace old image)
        // Assuming "Link" is in Column C (index 2) - based on prompt "Name ID Link"
        const LINK_COL_INDEX = 2;
        const currentLink = values[rowIndex][LINK_COL_INDEX];

        // Delete old file if exists
        if (currentLink && currentLink.includes("drive.google.com")) {
            try {
                const fileId = currentLink.match(/[-\w]{25,}/);
                if (fileId) {
                    DriveApp.getFileById(fileId[0]).setTrashed(true);
                }
            } catch (err) {
                Logger.log("Could not delete old file: " + err);
            }
        }

        // Save New Image
        const contentType = imageBase64.substring(5, imageBase64.indexOf(';'));
        const bytes = Utilities.base64Decode(imageBase64.substr(imageBase64.indexOf('base64,') + 7));
        const blob = Utilities.newBlob(bytes, contentType, studentId + "_" + dateString + ".jpg");

        const folder = DriveApp.getFolderById(FOLDER_ID);
        const file = folder.createFile(blob);
        const fileUrl = file.getUrl();

        // Update Link Column
        sheet.getRange(rowIndex + 1, LINK_COL_INDEX + 1).setValue(fileUrl);

        return ContentService.createTextOutput("Success");

    } catch (f) {
        return ContentService.createTextOutput("Error: " + f.toString());
    }
}
