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

        // 2. Handle Date Column (ROBUST CHECK)
        // We match by components (Day, Month, Year) to avoid Time/String confusion.
        const today = new Date();
        const TIMEZONE = ss.getSpreadsheetTimeZone();

        // Target components
        const tDay = parseInt(Utilities.formatDate(today, TIMEZONE, "d"), 10);
        const tMonth = parseInt(Utilities.formatDate(today, TIMEZONE, "M"), 10);
        const tYear = parseInt(Utilities.formatDate(today, TIMEZONE, "yyyy"), 10);
        const targetDateStr = `${tMonth}/${tDay}/${tYear}`; // M/d/yyyy

        let dateColIndex = -1;

        for (let j = 0; j < headers.length; j++) {
            const val = headers[j];
            let hDay, hMonth, hYear;

            if (Object.prototype.toString.call(val) === '[object Date]') {
                // If header is a Date object, extract components using sheet's timezone
                hDay = parseInt(Utilities.formatDate(val, TIMEZONE, "d"), 10);
                hMonth = parseInt(Utilities.formatDate(val, TIMEZONE, "M"), 10);
                hYear = parseInt(Utilities.formatDate(val, TIMEZONE, "yyyy"), 10);
            } else {
                // If header is String, try to parse M/d/yyyy
                const s = val.toString().trim();
                // Check if it looks like a date M/d/yyyy
                const parts = s.split('/');
                if (parts.length === 3) {
                    hMonth = parseInt(parts[0], 10);
                    hDay = parseInt(parts[1], 10);
                    hYear = parseInt(parts[2], 10);
                }
            }

            // Compare components
            if (hDay === tDay && hMonth === tMonth && hYear === tYear) {
                dateColIndex = j;
                break;
            }
        }

        if (dateColIndex === -1) {
            dateColIndex = headers.length;
            const newHeaderCell = sheet.getRange(1, dateColIndex + 1);
            // CRITICAL: Force Plain Text to prevent Google Sheets from auto-converting to Date object later
            newHeaderCell.setNumberFormat("@");
            newHeaderCell.setValue(targetDateStr);
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
        const blob = Utilities.newBlob(bytes, contentType, studentId + "_" + targetDateStr.replace(/\//g, '-') + ".jpg");

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
