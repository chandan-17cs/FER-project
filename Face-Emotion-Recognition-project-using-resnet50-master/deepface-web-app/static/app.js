// Emotion Configuration
const BACKEND_EMOTIONS = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise']; 

// Use the backend's official list to ensure all subsequent objects are keyed correctly.
const emotionColors = {
    angry: '#ef4444',
    disgust: '#84cc16',
    fear: '#8b5cf6',
    happy: '#10b981',
    neutral: '#6b7280',
    sad: '#3b82f6',
    surprise: '#f59e0b',
};

const emotionEmojis = {
    angry: '😠',
    disgust: '🤢',
    fear: '😨',
    happy: '😊',
    neutral: '😐',
    sad: '😢',
    surprise: '😮',
};

const emotionLabels = {
    angry: 'Angry',
    disgust: 'Disgust',
    fear: 'Fearful',
    happy: 'Happy',
    neutral: 'Neutral',
    sad: 'Sad',
    surprise: 'Surprised',
};

// Application State
const state = {
    isWebcamActive: false,
    isDetecting: false,
    detections: [],
    stream: null,
    detectionInterval: null
};

// DOM Elements
const elements = {
    webcam: document.getElementById('webcam'),
    webcamPlaceholder: document.getElementById('webcam-placeholder'),
    webcamToggle: document.getElementById('webcam-toggle'),
    detectionControls: document.getElementById('detection-controls'),
    detectionToggle: document.getElementById('detection-toggle'),
    resetButton: document.getElementById('reset-button'),
    emotionDisplay: document.getElementById('emotion-display'),
    historyContent: document.getElementById('history-content'),
    statsContent: document.getElementById('stats-content'),
    liveDot: document.getElementById('live-dot'),
    liveText: document.getElementById('live-text'),
    errorAlert: document.getElementById('error-alert'),
    errorText: document.getElementById('error-text')
};

// New: Create a hidden canvas element for capturing frames
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

// --- Utility Functions ---

function showError(message) {
    elements.errorText.textContent = message;
    elements.errorAlert.classList.remove('hidden');
}

function hideError() {
    elements.errorAlert.classList.add('hidden');
}

function updateWebcamButton() {
    if (state.isWebcamActive) {
        elements.webcamToggle.className = 'button button-red';
        elements.webcamToggle.innerHTML = `
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <line x1="1" y1="1" x2="23" y2="23" stroke="white" stroke-width="2"/>
            </svg>
            Stop Webcam
        `;
    } else {
        elements.webcamToggle.className = 'button button-green';
        elements.webcamToggle.innerHTML = `
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
            </svg>
            Start Webcam
        `;
    }
}

function updateDetectionButton() {
    if (state.isDetecting) {
        elements.detectionToggle.className = 'button button-orange';
        elements.detectionToggle.innerHTML = `
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
            </svg>
            Pause Detection
        `;
    } else {
        elements.detectionToggle.className = 'button button-blue';
        elements.detectionToggle.innerHTML = `
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Start Detection
        `;
    }
}

function updateResetButton() {
    elements.resetButton.disabled = state.detections.length === 0;
}

// --- Webcam Functions ---

async function startWebcam() {
    try {
        hideError();
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false
        });

        elements.webcam.srcObject = stream;
        state.stream = stream;
        state.isWebcamActive = true;

        elements.webcam.classList.remove('hidden');
        elements.webcamPlaceholder.classList.add('hidden');
        elements.liveDot.classList.add('active');
        elements.liveText.textContent = 'LIVE';

        updateWebcamButton();
        elements.detectionControls.classList.remove('hidden');
    } catch (error) {
        showError('Unable to access webcam. Please ensure you have granted camera permissions.');
        console.error('Webcam error:', error);
    }
}

function stopWebcam() {
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }

    elements.webcam.srcObject = null;
    state.isWebcamActive = false;

    elements.webcam.classList.add('hidden');
    elements.webcamPlaceholder.classList.remove('hidden');
    elements.liveDot.classList.remove('active');
    elements.liveText.textContent = 'OFFLINE';

    if (state.isDetecting) {
        stopDetection();
    }

    updateWebcamButton();
    elements.detectionControls.classList.add('hidden');
    // Clear display on stop
    updateEmotionDisplay(null); 
    resetDetections();
}


// --- Core Detection Function (Sends Frame to API) ---

async function sendFrameForDetection() {
    if (!state.isWebcamActive || elements.webcam.readyState !== 4) {
        showError('Webcam not ready. Please wait a moment.');
        return null;
    }

    canvas.width = elements.webcam.videoWidth;
    canvas.height = elements.webcam.videoHeight;

    // 2. Draw the current video frame onto the canvas (flipped horizontally to match display)
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(elements.webcam, 0, 0, canvas.width, canvas.height);
    // CRITICAL FIX: Reset transform to identity matrix (1, 0, 0, 1, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0); 

    return new Promise(resolve => {
        canvas.toBlob(async (blob) => {
            const formData = new FormData();
            formData.append('image', blob, 'webcam_frame.jpg');
            
            try {
                // 4. Send the image to the Flask API /predict endpoint
                const response = await fetch('/predict', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                
                if (result.success) {
                    hideError();
                    return resolve({
                        emotion: result.emotion,
                        confidence: result.confidence,
                        timestamp: Date.now()
                    });
                } else {
                    showError('Prediction API failed: ' + (result.error || 'Unknown error.'));
                    return resolve(null);
                }

            } catch (error) {
                showError('Error connecting to AI backend. Check the server is running. (' + error.message + ')');
                console.error('API Error:', error);
                return resolve(null);
            }
        }, 'image/jpeg', 0.8);
    });
}

// --- Detection Control Functions ---

function startDetection() {
    if (!state.isWebcamActive) {
        showError('Please start the webcam first.');
        return;
    }
    
    state.isDetecting = true;
    updateDetectionButton();

    const DETECTION_RATE_MS = 300; 
    
    if (state.detectionInterval) {
        clearInterval(state.detectionInterval);
    }
    
    state.detectionInterval = setInterval(async () => {
        const detection = await sendFrameForDetection();
        
        if (detection) {
            state.detections.push(detection);

            if (state.detections.length > 50) {
                state.detections = state.detections.slice(-50);
            }

            updateEmotionDisplay(detection);
            updateHistory();
            updateStats();
            updateResetButton();
        } else {
            if (state.isDetecting) {
                 stopDetection(); 
                 updateEmotionDisplay(null);
            }
        }
    }, DETECTION_RATE_MS);
}

function stopDetection() {
    state.isDetecting = false;
    updateDetectionButton();

    if (state.detectionInterval) {
        clearInterval(state.detectionInterval);
        state.detectionInterval = null;
    }
}

function resetDetections() {
    stopDetection();
    state.detections = [];
    updateEmotionDisplay(null);
    updateHistory();
    updateStats();
    updateResetButton();
}

// --- UI Update Functions (Original Logic) ---

function updateEmotionDisplay(detection) {
    if (!state.isWebcamActive || !state.isDetecting || !detection) {
        elements.emotionDisplay.innerHTML = `
            <div class="emotion-placeholder">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
                <h3 style="font-size: 1.25rem; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">No Detection</h3>
                <p style="color: #6b7280;">Start the webcam to begin emotion detection</p>
            </div>
        `;
        return;
    }

    const color = emotionColors[detection.emotion];
    elements.emotionDisplay.innerHTML = `
        <h3 style="font-size: 1.125rem; font-weight: 600; color: #374151; margin-bottom: 1.5rem; align-self: flex-start;">Current Emotion</h3>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 1.5rem; flex: 1; justify-content: center;">
            <div class="emotion-emoji">${emotionEmojis[detection.emotion]}</div>
            <div style="text-align: center;">
                <h2 class="emotion-label" style="color: ${color};">${emotionLabels[detection.emotion]}</h2>
                <div class="confidence">
                    <span style="font-size: 0.875rem; font-weight: 500;">Confidence:</span>
                    <span class="confidence-value" style="color: ${color};">${detection.confidence.toFixed(2)}%</span>
                </div>
            </div>
            <div class="progress-bar" style="width: 100%;">
                <div class="progress-fill" style="width: ${detection.confidence}%; background-color: ${color};"></div>
            </div>
        </div>
    `;
}

function updateHistory() {
    if (state.detections.length === 0) {
        elements.historyContent.className = 'empty-state';
        elements.historyContent.textContent = 'No detections yet';
        return;
    }

    elements.historyContent.className = '';
    const recent = state.detections.slice(-10).reverse();

    elements.historyContent.innerHTML = recent.map(detection => {
        const color = emotionColors[detection.emotion];
        const time = new Date(detection.timestamp).toLocaleTimeString();

        return `
            <div class="history-item">
                <div class="history-left">
                    <div class="history-dot" style="background-color: ${color};"></div>
                    <span style="font-weight: 500; color: #1f2937;">${emotionLabels[detection.emotion]}</span>
                </div>
                <div class="history-right">
                    <span class="history-confidence" style="color: ${color};">${detection.confidence.toFixed(2)}%</span>
                    <span class="history-time">${time}</span>
                </div>
            </div>
        `;
    }).join('');
}

function updateStats() {
    if (state.detections.length === 0) {
        elements.statsContent.className = 'empty-state';
        elements.statsContent.textContent = 'No data available';
        return;
    }

    elements.statsContent.className = '';

    const counts = {};
    state.detections.forEach(detection => {
        counts[detection.emotion] = (counts[detection.emotion] || 0) + 1;
    });

    const total = state.detections.length;
    const stats = Object.entries(counts)
        .map(([emotion, count]) => ({
            emotion,
            count,
            percentage: Math.round((count / total) * 100)
        }))
        .sort((a, b) => b.count - a.count);

    elements.statsContent.innerHTML = `
        ${stats.map(stat => {
            const color = emotionColors[stat.emotion];
            return `
                <div class="stat-item">
                    <div class="stat-header">
                        <span style="font-weight: 500; color: #1f2937;">${emotionLabels[stat.emotion]}</span>
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <span class="stat-count">${stat.count}x</span>
                            <span class="stat-percentage" style="color: ${color};">${stat.percentage}%</span>
                        </div>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${stat.percentage}%; background-color: ${color};"></div>
                    </div>
                </div>
            `;
        }).join('')}
        <div class="stat-total">
            <span style="color: #4b5563;">Total Detections</span>
            <span class="stat-total-value">${total}</span>
        </div>
    `;
}

// --- Event Listeners and Initialization ---

elements.webcamToggle.addEventListener('click', () => {
    if (state.isWebcamActive) {
        stopWebcam();
    } else {
        startWebcam();
    }
});

elements.detectionToggle.addEventListener('click', () => {
    if (state.isDetecting) {
        stopDetection();
    } else {
        startDetection();
    }
});

elements.resetButton.addEventListener('click', resetDetections);

console.log('Face Emotion Recognition App Loaded');
console.log('Click "Start Webcam" to begin');