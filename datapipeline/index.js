const fs = require('fs');
const path = require('path');
const emailService = require("../shared/emailService");

const callRefreshToken = async () => {
    try {
        const folderPath = path.join(__dirname, 'data');
        const filePath = path.join(folderPath, 'accessToken.txt');

        // Read existing token before API call
        let existingToken = '';
        if (fs.existsSync(filePath)) {
            existingToken = fs.readFileSync(filePath, 'utf-8').trim();
            console.log('Existing token from file:', existingToken);
        } else {
            console.log('No existing token file found. It will be created after API call.');
        }

        // API call using the token from file
        const response = await fetch('https://api.dhan.co/v2/RenewToken', {
            method: 'GET',
            headers: {
                'access-token': existingToken || 'default-token-if-missing',
                'dhanClientId': '1107726523' // deepam's client id
                // 'dhanClientId': '1108817865' // manas's client id
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API call failed:', errorText);
            return;
        }

        const data = await response.json();
        const tokenText = data?.token || '';

        console.log('API response:', data?.token);

        // Example: New token text (you can replace this with data from the API)

        // Ensure folder exists
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            console.log('Folder created:', folderPath);
        }

        // Write or overwrite token file
        fs.writeFileSync(filePath, tokenText);
        console.log('Token file updated:', filePath);

        // Optionally send email
        await emailService.sendAccessToken(tokenText, 'manas.smartxalgo@gmail.com');

    } catch (error) {
        console.error('Error in callRefreshToken:', error.message);
    }
};

module.exports = { callRefreshToken };