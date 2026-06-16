function getBase64Image(imgPath) {
    const fs = require('fs');
    const path = require('path');
    
    try {
        // Read image file
        const imgData = fs.readFileSync(path.join(__dirname, imgPath));
        // Convert to base64
        const base64 = Buffer.from(imgData).toString('base64');
        // Get image type from file extension
        const ext = path.extname(imgPath).substring(1);
        // Return complete base64 string
        return `data:image/${ext};base64,${base64}`;
    } catch (error) {
        console.error(`Error loading image: ${imgPath}`, error);
        return '';
    }
}

module.exports = { getBase64Image };
