const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const callRefreshToken = async () => {
    try {
        const folderPath = path.join(__dirname, 'data');
        const filePath = path.join(folderPath, 'accessToken.txt');

        // Ensure folder exists
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        // Read existing token
        let token = '';
        if (fs.existsSync(filePath)) {
            token = fs.readFileSync(filePath, 'utf-8').trim();
            console.log('Existing token from file:', token);
        } else {
            token = 'No token available';
            console.log('No existing token found, using default.');
        }

        // Example API call (disabled for now)

       /*  const response = await fetch('https://api.dhan.co/v2/RenewToken', {
            method: 'GET',
            headers: {
                'access-token': token,
                'dhanClientId': '1107726523'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API call failed:', errorText);
            return;
        }

        const data = await response.json();
        token = data?.token || token; // update token if API returns one
        fs.writeFileSync(filePath, token);
        console.log('Token file updated:', filePath); */


        // Send email using Resend
        await resend.emails.send({
            from: 'SmartXAlgo <onboarding@resend.dev>',
            to: 'manas.smartxalgo@gmail.com',
            subject: 'Your SmartXAlgo Access Token',
            html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Access Token</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 20px 0;">
        <table role="presentation" style="width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="padding: 20px 30px; background-color: #1976d2; border-radius: 6px 6px 0 0;">
              <h2 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">
                SmartXAlgo Access Token
              </h2>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 15px; color: #333333; font-size: 16px;">
                Hello,
              </p>

              <p style="margin: 0 0 15px; color: #555555; font-size: 15px; line-height: 1.6;">
                Here is your latest access token for SmartXAlgo:
              </p>

              <div style="margin: 20px 0; padding: 15px; background-color: #f0f7ff; border-left: 4px solid #1976d2; border-radius: 4px;">
                <p style="margin: 0; color: #333; font-size: 14px; word-break: break-all;">
                  <strong>Access Token:</strong><br>
                  <code style="background: #fff; padding: 8px 12px; border-radius: 4px; display: block; color: #d32f2f; font-size: 14px; border: 1px solid #e0e0e0;">
                    ${token}
                  </code>
                </p>
              </div>

              <p style="margin: 15px 0 0; color: #666666; font-size: 14px;">
                Please keep this token secure and do not share it with anyone.
              </p>

              <p style="margin: 20px 0 0; color: #666666; font-size: 14px;">
                Regards,<br>
                <strong style="color: #333333;">SmartXAlgo Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 15px 30px; background-color: #f8f9fa; border-radius: 0 0 6px 6px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #999999; font-size: 12px; text-align: center;">
                This is an automated message from SmartXAlgo.<br>
                Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
        });

        console.log('Email sent successfully!');
    } catch (error) {
        console.error('Error in callRefreshToken:', error.message);
    }
};

module.exports = { callRefreshToken };