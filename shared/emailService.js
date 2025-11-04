const nodemailer = require('nodemailer');
const hbs = require('nodemailer-express-handlebars');
const path = require('path');

class EmailService {
    constructor() {
        this.emailUser = process.env.EMAIL_USER || '';
        this.emailPassword = process.env.EMAIL_PASSWORD || '';
        this.transporter = null;
        this.initializeTransporter();
    }

    /**
     * Initialize email transporter with Handlebars configuration
     */
    initializeTransporter() {
        try {
            if (!this.emailUser || !this.emailPassword) {
                console.warn('⚠️ Email credentials not configured. Email service will not work.');
                return;
            }

            // Create transporter
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: this.emailUser,
                    pass: this.emailPassword
                }
            });

            // Configure Handlebars options
            const handlebarOptions = {
                viewEngine: {
                    extname: '.hbs',
                    layoutsDir: path.resolve(__dirname, 'templates'),
                    defaultLayout: false,
                    partialsDir: path.resolve(__dirname, 'templates'),
                },
                viewPath: path.resolve(__dirname, 'templates'),
                extName: '.hbs',
            };

            // Use Handlebars with transporter
            this.transporter.use('compile', hbs(handlebarOptions));

            // Verify transporter configuration
            this.transporter.verify((error, success) => {
                if (error) {
                    console.error('❌ Email transporter verification failed:', error.message);
                } else {
                    console.log('✅ Email service is ready to send emails');
                }
            });

        } catch (error) {
            console.error('❌ Error initializing email transporter:', error.message);
        }
    }

    /**
     * Send missed update notification email
     * @param {string} to - Recipient email address
     * @param {string} name - User's name
     * @param {string} time - Missed update time
     * @param {string} date - Date of missed update
     * @returns {Promise<Object>} - Result of email sending
     */
    async sendMissedUpdateEmail(to, name, time, date) {
        try {
            if (!this.transporter) {
                throw new Error('Email transporter not initialized. Please configure email credentials.');
            }

            if (!to) {
                throw new Error('Recipient email address is required');
            }

            const context = {
                name: name || 'User',
                time: time || 'scheduled',
                date: date || 'today'
            };

            // Mail options with template
            const mailOptions = {
                from: `"SmartXAlgo CRM" <${this.emailUser}>`,
                to: to,
                subject: 'Missed Update Notification - SmartXAlgo CRM',
                template: 'missed-update',
                context: context,
                text: `Hi ${context.name},\n\nYou missed your ${context.time} update on ${context.date}.\n\nPlease inform your manager immediately.\n\nRegards,\nHR Team\nSmartXAlgo`
            };

            console.log('📧 Sending missed update email to:', to);
            console.log('📋 Subject:', mailOptions.subject);
            console.log('📝 Context:', context);

            const info = await this.transporter.sendMail(mailOptions);

            console.log('✅ Email sent successfully:', info.messageId);
            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };

        } catch (error) {
            console.error('❌ Error sending missed update email:', error.message);
            console.error('❌ Error stack:', error.stack);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send welcome email to new user with login credentials
     * @param {string} email - User's email address
     * @param {string} password - User's password
     * @returns {Promise<Object>} - Result of email sending
     */
    async sendWelcomeEmail(email, password) {
        try {
            if (!this.transporter) {
                console.warn('⚠️ Email transporter not initialized. Skipping welcome email.');
                return {
                    success: false,
                    error: 'Email service not configured'
                };
            }

            if (!email) {
                throw new Error('Email address is required');
            }

            if (!password) {
                throw new Error('Password is required');
            }

            const context = {
                email: email,
                password: password
            };

            // Mail options with template
            const mailOptions = {
                from: `"SmartXAlgo CRM" <${this.emailUser}>`,
                to: email,
                subject: 'Welcome to SmartXAlgo CRM - Your Login Credentials',
                template: 'welcome-email',
                context: context,
                text: `Welcome to SmartXAlgo CRM!\n\nYour account has been successfully created.\n\nYour Login Credentials:\nEmail: ${context.email}\nPassword: ${context.password}\n\nPlease keep these credentials safe and change your password after first login.\n\nBest regards,\nHR Team\nSmartXAlgo`
            };

            console.log('📧 Sending welcome email to:', email);
            console.log('📋 Subject:', mailOptions.subject);

            const info = await this.transporter.sendMail(mailOptions);

            console.log('✅ Email sent successfully:', info.messageId);
            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };

        } catch (error) {
            console.error('❌ Error sending welcome email:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async sendAccessToken(token, email) {
        try {
            if (!this.transporter) {
                console.warn('Email transporter not initialized. Skipping welcome email.');
                return {
                    success: false,
                    error: 'Email service not configured'
                };
            }

            if (!token) {
                throw new Error('Token is required');
            }

            if (!email) {
                throw new Error('Email is required');
            }

            const context = {
                token: token
            }

            // Mail options with template
            const mailOptions = {
                from: `"SmartXAlgo CRM" <${this.emailUser}>`,
                to: email,
                subject: 'Dhan Access Token',
                template: 'access-token',
                context: context,
                text: `Your Access Token is:`
            };

            console.log('📧 Sending welcome email to:', email);
            console.log('📋 Subject:', mailOptions.subject);

            const info = await this.transporter.sendMail(mailOptions);

            console.log('Email sent successfully:', info.messageId);
            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };

        } catch (error) {
            console.error('Error sending welcome email:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new EmailService();
