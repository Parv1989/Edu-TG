async function getBase64FromImage(imgElement) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth;
        canvas.height = imgElement.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgElement, 0, 0);
        resolve(canvas.toDataURL('image/png').split(',')[1]);
    });
}

async function downloadPDF() {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    
    // Get content and create a temporary div
    const content = document.getElementById('final-preview-content');
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content.innerHTML;

    // Handle logo
    const logoImg = tempDiv.querySelector('#logo-preview');
    if (logoImg && !logoImg.style.display.includes('none')) {
        try {
            const logoBase64 = await getBase64FromImage(logoImg);
            const logoImageBytes = await pdfDoc.embedPng(logoBase64);
            const logoDims = logoImageBytes.scale(0.5); // Adjust scale as needed
            page.drawImage(logoImageBytes, {
                x: 50,
                y: height - logoDims.height - 50,
                width: logoDims.width,
                height: logoDims.height,
            });
        } catch (error) {
            console.error('Error embedding logo:', error);
        }
    }

    // Handle question images
    const questionImages = tempDiv.querySelectorAll('.question-image');
    let currentY = height - 150; // Start below logo

    for (const imgElement of questionImages) {
        try {
            const imgBase64 = await getBase64FromImage(imgElement);
            const imageBytes = await pdfDoc.embedPng(imgBase64);
            const imgDims = imageBytes.scale(0.3); // Adjust scale as needed

            // Check if we need to add a new page
            if (currentY - imgDims.height < 50) {
                page = pdfDoc.addPage();
                const size = page.getSize();
                width = size.width;
                height = size.height;
                currentY = height - 50;
            }

            page.drawImage(imageBytes, {
                x: 50,
                y: currentY - imgDims.height,
                width: imgDims.width,
                height: imgDims.height,
            });

            currentY -= (imgDims.height + 20); // Add some spacing
        } catch (error) {
            console.error('Error embedding question image:', error);
        }
    }

    // Save the PDF
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'test-paper.pdf';
    link.click();
    URL.revokeObjectURL(url);
}


async function imageToDataURL(img){
    try{
        const canvas=document.createElement('canvas');
        canvas.width=img.naturalWidth||img.width;
        canvas.height=img.naturalHeight||img.height;
        canvas.getContext('2d').drawImage(img,0,0);
        return canvas.toDataURL('image/png');
    }catch(e){
        return img.src;
    }
}

async function saveAsDoc(){
    try{
        const fpc = document.getElementById('final-preview-content');

        // Clean copy banao
        const clone = fpc.cloneNode(true);

        // Print preview jaisi cleaning
        clone.querySelectorAll('.inline-ans-row').forEach(el => el.remove());

        clone.querySelectorAll(
            '.fp-btn-col, .fp-action-bar, .fp-btn, .no-print,' +
            '.img-replace-btn, .img-replace-wrapper button,' +
            '.sub-item-btn, .sub-item-actions,' +
            '#preview-edit-hint'
        ).forEach(el => el.remove());

        // Wrapper hatao
        clone.querySelectorAll('.img-replace-wrapper').forEach(w => {
            const img = w.querySelector('img');
            if(img){
                w.parentNode.insertBefore(img, w);
            }
            w.remove();
        });

        // Images embed
        const origImgs = fpc.querySelectorAll('img');
        const cloneImgs = clone.querySelectorAll('img');

        for(let i=0;i<origImgs.length;i++){
            cloneImgs[i].src = await imageToDataURL(origImgs[i]);
        }

        const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body{
    font-family: Arial, sans-serif;
    line-height:1.6;
    padding:10px 25px;
    font-size:16px;
}

.marks-right{
    float:right;
}

img{
    max-width:100%;
    height:auto;
}

.question-image{
    max-width:100%;
    height:auto;
}

.matching-table{
    width:100%;
    border-collapse:collapse;
}

.matching-table th,
.matching-table td{
    border:1px solid #ccc;
    padding:6px 10px;
}

table{
    width:100%;
    border-collapse:collapse;
}

td{
    padding:8px;
}

.fp-question-inner{
    display:block !important;
}

[contenteditable]{
    outline:none !important;
}
</style>
</head>
<body>
${clone.innerHTML}
</body>
</html>`;

        const blob = htmlDocx.asBlob(html);
        saveAs(blob,'test-paper.docx');

    }catch(err){
        console.error(err);
        alert('DOC export failed: ' + err.message);
    }
}
