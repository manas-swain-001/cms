const express = require('express');
const { body, validationResult } = require('express-validator');
const { User } = require('../models/User');
const { auth, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../constant/enum');
const smsService = require('../modules/smsService');

const router = express.Router();

// @route   POST /api/sms/send
// @desc    Send WhatsApp messages to users by their IDs (supports single or multiple users)
// @access  Private (Admin/Manager)
router.post('/salary', [
  auth,
  authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER),
  body('userIds')
    .isArray({ min: 1 })
    .withMessage('userIds must be a non-empty array of user IDs'),
  body('userIds.*')
    .isMongoId()
    .withMessage('Each userId must be a valid MongoDB ObjectId'),
  body('message')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Message cannot exceed 1000 characters')
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

    const { userIds, message } = req.body;

    console.log('📨 SMS Request received for user IDs:', userIds);

    // Find users by IDs
    const users = await User.find({
      _id: { $in: userIds },
      isActive: true
    }).select('firstName lastName email phone accNo salary employeeId office');

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active users found with the provided IDs'
      });
    }

    if (users.length !== userIds.length) {
      const foundIds = users.map(user => user._id.toString());
      const missingIds = userIds.filter(id => !foundIds.includes(id));
      
      console.warn('⚠️ Some users not found:', missingIds);
    }

    // Log user data to console
    smsService.logUserData(users);

    // Send WhatsApp messages
    const results = await smsService.sendWhatsAppMessage(users);

    // Calculate success/failure counts
    const successCount = results.filter(result => result.success).length;
    const failureCount = results.filter(result => !result.success).length;

    res.json({
      success: true,
      message: `SMS processing completed. ${successCount} sent, ${failureCount} failed`,
      data: {
        totalUsers: users.length,
        successCount,
        failureCount,
        results: results.map(result => ({
          userId: result.userId,
          phoneNumber: result.phoneNumber,
          success: result.success,
          messageId: result.messageId,
          error: result.error
        }))
      }
    });

  } catch (error) {
    console.error('❌ SMS API error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while processing SMS request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


module.exports = router;