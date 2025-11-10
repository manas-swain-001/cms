const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const emailService = require('../shared/emailService');

const router = express.Router();

// @route   POST /api/email/send
// @desc    Send missed update notification email to a user
// @access  Private
router.post('/send', [
    auth,
    body('to')
        .isEmail()
        // .normalizeEmail()
        .withMessage('Please provide a valid email address'),
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Name is required'),
    body('time')
        .trim()
        .notEmpty()
        .withMessage('Time is required'),
    body('date')
        .trim()
        .notEmpty()
        .withMessage('Date is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { to, name, time, date } = req.body;

        // Send email - subject and template are defined in the service
        const result = await emailService.sendMissedUpdateEmail(to, name, time, date);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to send email',
                error: result.error
            });
        }

        res.json({
            success: true,
            message: 'Missed update notification sent successfully',
            data: {
                to: to,
                messageId: result.messageId
            }
        });

    } catch (error) {
        console.error('Send email error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while sending email',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// @route   POST /api/email/send-welcome
// @desc    Send welcome email with login credentials to a new user
// @access  Private
router.post('/send-welcome', [
    auth,
    body('email')
        .isEmail()
        // .normalizeEmail()
        .withMessage('Please provide a valid email'),
    body('password')
        .trim()
        .notEmpty()
        .withMessage('Password is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { email, password } = req.body;

        // Send welcome email with login credentials - won't crash if fails
        const result = await emailService.sendWelcomeEmail(email, password);

        if (!result.success) {
            console.warn('⚠️ Failed to send welcome email, but continuing:', result.error);
            // Don't return error - just log and continue
        }

        res.json({
            success: true,
            message: result.success ? 'User created and welcome email sent successfully' : 'User created successfully (email sending failed)',
            data: {
                email: email,
                emailSent: result.success,
                messageId: result.messageId || null
            }
        });

    } catch (error) {
        console.error('Send welcome email error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while sending email',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;