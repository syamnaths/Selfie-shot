const video = document.getElementById('video');
const captureBtn = document.getElementById('capture-btn');
const studentIdInput = document.getElementById('student-id');
const statusMessage = document.getElementById('status-message');
const statusBadge = document.getElementById('status-badge');
const canvas = document.getElementById('overlay');

// Load saved ID
const savedId = localStorage.getItem('student-id-val');
if (savedId) {
    studentIdInput.value = savedId;
}

let faceMatcher;
let stream;
let currentMentor = "Unknown";

// UI Helper: Update badge style
function updateStatus(message, type = 'loading') {
    statusMessage.innerText = message;
    // Reset classes
    statusBadge.className = 'status-badge';
    // Add type class
    if (type === 'success') statusBadge.classList.add('status-success');
    else if (type === 'error') statusBadge.classList.add('status-error');
    else statusBadge.classList.add('status-loading');
}

// 1. Load Models
console.log('Debugging faceapi:', faceapi);
console.log('Debugging faceapi.nets:', faceapi.nets);

Promise.all([
    faceapi.loadSsdMobilenetv1Model('./models'),
    faceapi.loadFaceLandmarkModel('./models'),
    faceapi.loadFaceRecognitionModel('./models')
]).then(loadLabeledImages).catch(err => {
    updateStatus("Error loading models.", 'error');
    console.error(err);
});

// 2. Load Trained Data
async function loadLabeledImages() {
    updateStatus("Loading mentor data...", 'loading');

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
        updateStatus("No training data found.", 'error');
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
        updateStatus("Error processing training data.", 'error');
        startVideo(); // Start video even on error
    }
}

function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: {} })
        .then(s => {
            stream = s;
            video.srcObject = s;
            updateStatus("Ready. Look at the camera.", 'loading');
            captureBtn.disabled = false;
            startRecognition();
        })
        .catch(err => console.error(err));
}

function startRecognition() {
    // Helper for robust dimensions
    const getDisplaySize = () => {
        const w = video.clientWidth || video.videoWidth;
        const h = video.clientHeight || video.videoHeight;
        return {
            width: w > 0 ? w : 640,
            height: h > 0 ? h : 480
        };
    };

    // Initial Size
    let displaySize = getDisplaySize();
    faceapi.matchDimensions(canvas, displaySize);

    // Dynamic Resize Handler
    window.addEventListener('resize', () => {
        displaySize = getDisplaySize();
        faceapi.matchDimensions(canvas, displaySize);
    });

    setInterval(async () => {
        if (!faceMatcher || video.paused || video.ended) return;

        // Ensure displaySize stays synced in loop just in case
        if (video.clientWidth !== displaySize.width || video.clientHeight !== displaySize.height) {
            displaySize = getDisplaySize();
            // Only update if dimensions genuinely changed/valid
            if (displaySize.width > 0 && displaySize.height > 0) {
                faceapi.matchDimensions(canvas, displaySize);
            }
        }

        const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

        let foundMatch = false;

        results.forEach((result, i) => {
            const box = resizedDetections[i].detection.box;
            const drawBox = new faceapi.draw.DrawBox(box, { label: result.toString() });
            drawBox.draw(canvas);

            // Logic: If match found AND confident
            if (result.label !== 'unknown') {
                foundMatch = true;
                currentMentor = result.label;
            }
        });

        if (foundMatch) {
            updateStatus(`Mentor: ${currentMentor}`, 'success');
        } else {
            updateStatus("Unknown person", 'loading');
            currentMentor = "Unknown";
        }

    }, 100);
}

captureBtn.addEventListener('click', async () => {
    // 0. Check Mentor
    if (!currentMentor || currentMentor === 'Unknown') {
        alert("Please take attendance with your mentor.");
        updateStatus("Attendance blocked: Mentor unknown.", 'error');
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
        updateStatus("Error processing image.", 'error');
        return;
    }

    // 4. Send to Google Sheets (GAS)
    const gasUrl = "https://script.google.com/macros/s/AKfycbzjV8eSZFTj9WtMSRF9vB2dkbVPNN4NAyci7EoQea9a2GBJEHrUK3mTCGcw2Z7P19BAOQ/exec";

    updateStatus("Submitting attendance...", 'loading');
    captureBtn.disabled = true; // Disable button
    const btnText = captureBtn.querySelector('.btn-text');
    if (btnText) btnText.innerText = "Processing...";

    try {
        const payload = {
            studentId: studentId,
            studentName: "Unknown (Lookup pending)",
            image: lowResBase64 // sending compressed image
        };

        const response = await fetch(gasUrl, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain"
            },
            body: JSON.stringify(payload)
        });

        // alert("Attendance submitted! (Check Sheet)"); // Legacy alert removed for Kiosk feel
        updateStatus("Submitted successfully.", 'success');

        // --- Show Result Card ---
        const resultCard = document.getElementById('result-card');
        const rName = document.getElementById('result-name');
        const rId = document.getElementById('result-id');
        const rTime = document.getElementById('result-time');

        if (resultCard) {
            rName.innerText = "Attendance Marked"; // Or real name if we had it
            rId.innerText = `ID: ${studentId}`;
            rTime.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            resultCard.classList.remove('hidden');

            // Auto-hide after 3 seconds
            setTimeout(() => {
                resultCard.classList.add('hidden');
            }, 3000);
        }

    } catch (e) {
        console.error(e);
        updateStatus("Error submitting: " + e.message, 'error');
    } finally {
        captureBtn.disabled = false;
        if (btnText) btnText.innerText = "Check In";
        studentIdInput.value = ''; // Clear input for next user
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

// --- PWA Install Logic ---
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    if (installBtn) installBtn.classList.remove('hidden');
    console.log("Install prompt captured");
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again, throw it away
        deferredPrompt = null;
        // Hide the button
        installBtn.classList.add('hidden');
    });
}

// Check if app is already installed/standalone
if (window.matchMedia('(display-mode: standalone)').matches) {
    if (installBtn) installBtn.classList.add('hidden');
}

// --- Accessibility: Click-Anywhere to Check In (Landscape) ---
document.body.addEventListener('click', (e) => {
    // Only applies if:
    // 1. In Landscape mode
    // 2. Click target is NOT an input or button (to avoid conflict)
    // 3. Capture button is active

    const isLandscape = window.innerWidth > window.innerHeight;
    const isInteractive = e.target.closest('input') || e.target.closest('button') || e.target.closest('a');

    if (isLandscape && !isInteractive && !captureBtn.disabled) {
        // Visual feedback (optional ripple could go here, for now just click)
        console.log("Landscape tap triggered check-in");
        captureBtn.click();
    }
});

