const video = document.getElementById('video');
const trainBtn = document.getElementById('train-btn');
const saveBtn = document.getElementById('save-btn');
const mentorNameInput = document.getElementById('mentor-name');
const statusMessage = document.getElementById('status-message');

let labeledFaceDescriptors = [];

// Load Models
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri('./models'), // Ensure this path is correct
    faceapi.nets.faceLandmark68.loadFromUri('./models'),
    faceapi.nets.faceRecognition.loadFromUri('./models')
]).then(startVideo).catch(err => {
    console.error(err);
    statusMessage.innerText = "Error loading models: " + err;
    // Fallback to CDN if local fails (optional, but good for testing without server)
    // For now, let's assume local server.
});

function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: {} })
        .then(stream => {
            video.srcObject = stream;
            statusMessage.innerText = "Models Loaded. Ready to Train.";
            trainBtn.disabled = false;
        })
        .catch(err => console.error(err));
}

trainBtn.addEventListener('click', async () => {
    const name = mentorNameInput.value.trim();
    if (!name) {
        alert("Please enter a mentor name.");
        return;
    }

    statusMessage.innerText = "Detecting face...";

    // Detect face
    const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();

    if (detection) {
        console.log(detection.descriptor);
        // Add to our list
        // Check if we already have this person
        const existing = labeledFaceDescriptors.find(l => l.label === name);
        if (existing) {
            existing.descriptors.push(detection.descriptor);
        } else {
            labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(name, [detection.descriptor]));
        }

        statusMessage.innerText = `Face captured for ${name}!`;
        saveBtn.disabled = false;

        // Visual feedback
        const canvas = document.getElementById('overlay');
        const displaySize = { width: video.width, height: video.height };
        faceapi.matchDimensions(canvas, displaySize);
        const resizedDetections = faceapi.resizeResults(detection, displaySize);
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        faceapi.draw.drawDetections(canvas, resizedDetections);
    } else {
        statusMessage.innerText = "No face detected. Try again.";
    }
});

saveBtn.addEventListener('click', () => {
    // Save to LocalStorage
    // We need to serialize the Float32Array descriptors
    const serializable = labeledFaceDescriptors.map(lfd => ({
        label: lfd.label,
        descriptors: lfd.descriptors.map(d => Array.from(d)) // Convert Float32Array to regular array
    }));

    localStorage.setItem('mentor-faces', JSON.stringify(serializable));
    alert("Training data saved to LocalStorage!");

    // Also offer download as JSON (for persistence across devices/reloads if cache cleared)
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(serializable));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "mentor_faces.json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
});

