const axios = require('axios');

class SMSService {
    constructor() {
        this.whatsappApiUrl = process.env.WHATSAPP_API_URL || '';
        this.whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
        this.whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
        this.whatsappTemplateName = process.env.WHATSAPP_TEMPLATE_NAME || '';
    }

    /**
     * Send WhatsApp message to a single phone number (internal method)
     * @param {string} phoneNumber - Phone number in international format (e.g., 919861053987)
     * @param {string} message - Message to send
     * @param {Object} userData - User data (accNo, salary, etc.)
     * @returns {Promise<Object>} - API response
     */
    async sendSingleWhatsAppMessage(phoneNumber, message, userData = {}) {
        try {
            if (!this.whatsappAccessToken) {
                throw new Error('WhatsApp access token not configured');
            }

            const url = `${this.whatsappApiUrl}${this.whatsappPhoneNumberId}/messages`;

            const payload = {
                messaging_product: "whatsapp",
                to: phoneNumber,
                type: "template",
                template: {
                    name: this.whatsappTemplateName,
                    language: {
                        code: "en_US"
                    },
                    /* components: [
                        {
                            type: "body",
                            parameters: [
                                {
                                    type: "text",
                                    text: userData.firstName || "User"
                                },
                                {
                                    type: "text",
                                    text: userData.accNo || "N/A"
                                },
                                {
                                    type: "text",
                                    text: userData.salary ? `₹${userData.salary}` : "N/A"
                                }
                            ]
                        }
                    ] */
                }
            };

            console.log('📱 Sending WhatsApp message to:', phoneNumber);
            console.log('📊 User data:', {
                name: userData.firstName,
                accNo: userData.accNo,
                salary: userData.salary
            });

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.whatsappAccessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('✅ WhatsApp message sent successfully:', response.data);
            return {
                success: true,
                messageId: response.data.messages?.[0]?.id,
                data: response.data
            };

        } catch (error) {
            console.error('❌ WhatsApp API error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message
            };
        }
    }

    /**
     * Send WhatsApp messages to users (main method - accepts array of users)
     * @param {Array} users - Array of user objects with phone numbers and data
     * @returns {Promise<Array>} - Results of all messages
     */
    async sendWhatsAppMessage(users) {
        // If single user passed, convert to array
        if (!Array.isArray(users)) {
            users = [users];
        }

        console.log(`📨 Processing ${users.length} user(s) for WhatsApp messages`);

        const results = [];
        
        for (const user of users) {
            if (!user.phone) {
                console.warn('⚠️ No phone number for user:', user.firstName || user.email);
                results.push({
                    userId: user._id,
                    success: false,
                    error: 'No phone number provided'
                });
                continue;
            }

            // Format phone number (remove any non-digits and ensure it starts with country code)
            let phoneNumber = user.phone.replace(/\D/g, '');
            if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
                phoneNumber = '91' + phoneNumber;
            }

            const result = await this.sendSingleWhatsAppMessage(phoneNumber, '', user);
            results.push({
                userId: user._id,
                phoneNumber: phoneNumber,
                ...result
            });

            // Add delay between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return results;
    }

    /**
     * Log user data to console (for debugging)
     * @param {Array} users - Array of user objects
     */
    logUserData(users) {
        console.log('\n📋 User Data Summary:');
        console.log('='.repeat(50));

        users.forEach((user, index) => {
            console.log(`\n👤 User ${index + 1}:`);
            console.log(`   Name: ${user.firstName} ${user.lastName}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Phone: ${user.phone || 'N/A'}`);
            console.log(`   Employee ID: ${user.employeeId || 'N/A'}`);
            console.log(`   Account No: ${user.accNo || 'N/A'}`);
            console.log(`   Salary: ${user.salary ? `₹${user.salary}` : 'N/A'}`);
            console.log(`   Office: ${user.office || 'N/A'}`);
        });

        console.log('\n' + '='.repeat(50));
    }
}

module.exports = new SMSService();