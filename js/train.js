const video = document.getElementById('video');
const trainBtn = document.getElementById('train-btn');
const saveBtn = document.getElementById('save-btn');
const mentorNameInput = document.getElementById('mentor-name');
const importFileInput = document.getElementById('import-file');
const sampleCountSpan = document.getElementById('sample-count');
const statusMessage = document.getElementById('status-message');
const statusBadge = document.getElementById('status-badge');
const canvas = document.getElementById('overlay');

let labeledFaceDescriptors = [];

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

// UI Helper: Update sample count
function updateSampleCount() {
    const name = mentorNameInput.value.trim();
    if (!name) {
        sampleCountSpan.innerText = '0 (Enter Name)';
        return;
    }
    const existing = labeledFaceDescriptors.find(l => l.label === name);
    const count = existing ? existing.descriptors.length : 0;
    sampleCountSpan.innerText = count.toString();
}

mentorNameInput.addEventListener('input', updateSampleCount);

// Load Models
Promise.all([
    faceapi.loadSsdMobilenetv1Model('./models'),
    faceapi.loadFaceLandmarkModel('./models'),
    faceapi.loadFaceRecognitionModel('./models')
]).then(startVideo).catch(err => {
    console.error(err);
    updateStatus("Error loading models.", 'error');
});

function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: {} })
        .then(stream => {
            video.srcObject = stream;
            updateStatus("Models Loaded. Ready.", 'success');
            trainBtn.disabled = false;
        })
        .catch(err => console.error(err));
}

// Handle Resize
function getDisplaySize() {
    const w = video.clientWidth || video.videoWidth;
    const h = video.clientHeight || video.videoHeight;
    return {
        width: w > 0 ? w : 640,
        height: h > 0 ? h : 480
    };
}

window.addEventListener('resize', () => {
    if (video) {
        faceapi.matchDimensions(canvas, getDisplaySize());
    }
});

// Import Logic
importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    updateStatus("Importing data...", 'loading');
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target.result);
            // Deserialize: Convert plain arrays back to Float32Array + LabeledFaceDescriptors
            json.forEach(item => {
                const descriptors = item.descriptors.map(d => new Float32Array(d));
                const existing = labeledFaceDescriptors.find(l => l.label === item.label);

                if (existing) {
                    // Merge descriptors if person exists
                    existing.descriptors.push(...descriptors);
                } else {
                    labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(item.label, descriptors));
                }
            });

            updateStatus(`Imported ${json.length} mentors!`, 'success');
            saveBtn.disabled = false;
            updateSampleCount(); // Update count if name is typed
        } catch (err) {
            console.error(err);
            updateStatus("Error parsing JSON file.", 'error');
        }
    };
    reader.readAsText(file);
});


trainBtn.addEventListener('click', async () => {
    const name = mentorNameInput.value.trim();
    if (!name) {
        alert("Please enter a mentor name.");
        return;
    }

    updateStatus("Detecting face...", 'loading');

    // Detect face
    const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();

    if (detection) {
        // Add to our list
        const existing = labeledFaceDescriptors.find(l => l.label === name);
        if (existing) {
            existing.descriptors.push(detection.descriptor);
        } else {
            labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(name, [detection.descriptor]));
        }

        updateStatus(`Captured! Total: ${labeledFaceDescriptors.find(l => l.label === name).descriptors.length}`, 'success');
        saveBtn.disabled = false;
        updateSampleCount();

        // Visual feedback
        const displaySize = getDisplaySize();
        faceapi.matchDimensions(canvas, displaySize);
        const resizedDetections = faceapi.resizeResults(detection, displaySize);
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        faceapi.draw.drawDetections(canvas, resizedDetections);
    } else {
        updateStatus("No face detected. Try again.", 'error');
    }
});

saveBtn.addEventListener('click', () => {
    // Save to LocalStorage
    const serializable = labeledFaceDescriptors.map(lfd => ({
        label: lfd.label,
        descriptors: lfd.descriptors.map(d => Array.from(d))
    }));

    localStorage.setItem('mentor-faces', JSON.stringify(serializable));
    alert("Training data saved to LocalStorage!");

    // Also offer download as JSON
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(serializable));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "mentor_faces.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
});

// --- Modal Logic ---
const selectMentorBtn = document.getElementById('select-mentor-btn');
const modal = document.getElementById('mentor-modal');
const closeModalBtn = document.getElementById('close-modal');
const mentorList = document.getElementById('mentor-list');

// Open Modal
selectMentorBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    renderMentorList();
});

// Close Modal
closeModalBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
});

// Close on backdrop click
window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.add('hidden');
    }
});

// Render List
function renderMentorList() {
    mentorList.innerHTML = '';

    if (labeledFaceDescriptors.length === 0) {
        mentorList.innerHTML = '<p class="empty-state">No mentors loaded yet. Import a file first.</p>';
        return;
    }

    labeledFaceDescriptors.forEach(lfd => {
        const item = document.createElement('div');
        item.className = 'mentor-item';
        item.innerHTML = `
            <span class="mentor-name">${lfd.label}</span>
            <span class="mentor-count">${lfd.descriptors.length} samples</span>
        `;

        item.addEventListener('click', () => {
            mentorNameInput.value = lfd.label;
            modal.classList.add('hidden');
            updateSampleCount();
            updateStatus(`Selected ${lfd.label}. Ready to add samples.`, 'success');
        });

        mentorList.appendChild(item);
    });
}

