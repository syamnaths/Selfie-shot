const video = document.getElementById('video');
const captureBtn = document.getElementById('capture-btn');
const studentIdInput = document.getElementById('student-id');
const statusMessage = document.getElementById('status-message');
const canvas = document.getElementById('overlay');

// Load saved ID
const savedId = localStorage.getItem('student-id-val');
if (savedId) {
    studentIdInput.value = savedId;
}

let faceMatcher;
let stream;
let currentMentor = "Unknown";

// 1. Load Models
console.log('Debugging faceapi:', faceapi);
console.log('Debugging faceapi.nets:', faceapi.nets);

Promise.all([
    faceapi.loadSsdMobilenetv1Model('./models'),
    faceapi.loadFaceLandmarkModel('./models'),
    faceapi.loadFaceRecognitionModel('./models')
]).then(loadLabeledImages).catch(err => {
    statusMessage.innerText = "Error loading models.";
    console.error(err);
});

// 2. Load Trained Data
async function loadLabeledImages() {
    statusMessage.innerText = "Loading mentor data...";

    let data = null;
    try {
        const response = await fetch('mentors/mentor_faces.json');
        if (response.ok) {
            data = await response.json();
            console.log("Loaded mentor data from file.");
        }
    } catch (err) {
        console.log("External mentor file not accessible.");
    }

    if (!data) {
        const localData = localStorage.getItem('mentor-faces');
        if (localData) {
            try {
                data = JSON.parse(localData);
                console.log("Loaded mentor data from LocalStorage.");
            } catch (e) {
                console.error("Error parsing local storage data.", e);
            }
        }
    }

    if (!data) {
        statusMessage.innerText = "No training data found. Please run Training mode first.";
        startVideo(); // Start video anyway so user sees camera
        return;
    }

    try {
        const labeledDescriptors = data.map(l => {
            // Convert plain arrays back to Float32Array
            const descriptors = l.descriptors.map(d => new Float32Array(d));
            return new faceapi.LabeledFaceDescriptors(l.label, descriptors);
        });

        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
        startVideo();
    } catch (e) {
        console.error(e);
        statusMessage.innerText = "Error processing training data.";
        startVideo(); // Start video even on error
    }
}

function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: {} })
        .then(s => {
            stream = s;
            video.srcObject = s;
            statusMessage.innerText = "Ready. Look at the camera.";
            captureBtn.disabled = false;
            startRecognition();
        })
        .catch(err => console.error(err));
}

function startRecognition() {
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        if (!faceMatcher) return;

        const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

        results.forEach((result, i) => {
            const box = resizedDetections[i].detection.box;
            const drawBox = new faceapi.draw.DrawBox(box, { label: result.toString() });
            drawBox.draw(canvas);

            // Logic: If match found AND confident
            if (result.label !== 'unknown') {
                statusMessage.innerText = `Mentor Detected: ${result.label}`;
                currentMentor = result.label;
            } else {
                statusMessage.innerText = "Unknown person";
                currentMentor = "Unknown";
            }
        });
    }, 100);
}

captureBtn.addEventListener('click', async () => {
    // 0. Check Mentor
    if (!currentMentor || currentMentor === 'Unknown') {
        alert("Please take attendance with your mentor.");
        statusMessage.innerText = "Attendance blocked: Mentor unknown.";
        return;
    }

    // 1. Validate inputs
    const studentId = studentIdInput.value.trim();
    if (!studentId) {
        alert("Please enter Student ID.");
        return;
    }

    // Save ID
    localStorage.setItem('student-id-val', studentId);

    // 2. Capture Image
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Watermark
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    const timestamp = new Date().toLocaleString();
    const watermarkText = `${timestamp} mentors: ${currentMentor}. Student id: ${studentId}`;
    ctx.fillText(watermarkText, 20, captureCanvas.height - 20);
    ctx.strokeText(watermarkText, 20, captureCanvas.height - 20);

    // 3. Compress Image to < 10KB
    let lowResBase64;
    try {
        lowResBase64 = await compressImageToSize(captureCanvas, 10 * 1024); // 10KB limit
        console.log("Compressed image size:", Math.round(lowResBase64.length * 0.75 / 1024), "KB");
    } catch (err) {
        console.error("Compression failed:", err);
        statusMessage.innerText = "Error processing image.";
        return;
    }

    // 4. Send to Google Sheets (GAS)
    // We need the Web App URL. For now we prompt or mock.
    const gasUrl = "https://script.google.com/macros/s/AKfycbwsoqEGAs2PlrMGrNE4cq40bE1fWtVw---ryuzt8-yvLv1l4z5UIImXHrnWu6uUDp9k7Q/exec";

    statusMessage.innerText = "Submitting attendance...";
    captureBtn.disabled = true; // Disable button
    captureBtn.innerText = "Processing..."; // Change text

    try {
        const payload = {
            studentId: studentId,
            studentName: "Unknown (Lookup pending)",
            image: lowResBase64 // sending compressed image
        };

        // GAS usually requires no-cors for simple GET/POST from browser if not using specialized libs, 
        // but fetch with POST text/plain is standard for this hack.

        await fetch(gasUrl, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain"
            },
            body: JSON.stringify(payload)
        });

        alert("Attendance submitted! (Check Sheet)");
        statusMessage.innerText = "Submitted successfully.";
    } catch (e) {
        console.error(e);
        statusMessage.innerText = "Error submitting: " + e.message;
    } finally {
        captureBtn.disabled = false;
        captureBtn.innerText = "Capture Attendance";
    }
});

// Helper: Iteratively compress image until < maxBytes
async function compressImageToSize(sourceCanvas, maxBytes) {
    let quality = 0.7;
    let scale = 0.5;
    let resultBase64 = sourceCanvas.toDataURL('image/jpeg', quality);

    // Initial check (rough estimation: base64 length * 0.75 = byte size)
    while ((resultBase64.length * 0.75) > maxBytes && (quality > 0.1 || scale > 0.1)) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = sourceCanvas.width * scale;
        tempCanvas.height = sourceCanvas.height * scale;
        tempCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

        resultBase64 = tempCanvas.toDataURL('image/jpeg', quality);

        if ((resultBase64.length * 0.75) > maxBytes) {
            // Reduce more aggressively
            scale *= 0.8;
            quality *= 0.8;
        }
    }
    return resultBase64;
}

