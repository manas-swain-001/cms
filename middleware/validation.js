const { body, param, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { USER_ROLES } = require('../constant/enum');

// Helper function to handle validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.path || error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Custom validators
const isValidObjectId = (value) => {
  return mongoose.Types.ObjectId.isValid(value);
};

const isValidCoordinate = (value) => {
  const num = parseFloat(value);
  return !isNaN(num) && isFinite(num);
};

const isValidTimeSlot = (value) => {
  return ['morning', 'afternoon', 'evening'].includes(value);
};

const isValidRole = (value) => {
  return Object.values(USER_ROLES).includes(value);
};

const isValidAttendanceStatus = (value) => {
  return ['present', 'absent', 'partial', 'late'].includes(value);
};

const isValidTaskStatus = (value) => {
  return ['not_started', 'in_progress', 'completed', 'overdue'].includes(value);
};

// Authentication validation
const validateRegister = [
  body('email')
    .isEmail()
    // .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('role')
    .optional()
    .custom(isValidRole)
    .withMessage('Role must be ' + Object.values(USER_ROLES).join(', ')),
  body('office')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Office must be between 2 and 100 characters'),
  body('department')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Department must be between 2 and 100 characters'),
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  handleValidationErrors
];

const validateLogin = [
  body('email')
    .isEmail()
    // .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  body('biometricData')
    .optional()
    .isObject()
    .withMessage('Biometric data must be an object'),
  handleValidationErrors
];

const validatePasswordReset = [
  body('email')
    .isEmail()
    // .normalizeEmail()
    .withMessage('Please provide a valid email'),
  handleValidationErrors
];

const validatePasswordUpdate = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  handleValidationErrors
];

// User validation
const validateUserId = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid user ID'),
  handleValidationErrors
];

const validateUserUpdate = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    // .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('role')
    .optional()
    .custom(isValidRole)
    .withMessage('Role must be ' + Object.values(USER_ROLES).join(', ')),
  body('office')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Office must be between 2 and 100 characters'),
  body('department')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Department must be between 2 and 100 characters'),
  body('designation')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Designation must be between 2 and 100 characters'),
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  handleValidationErrors
];

const validateRoleAssignment = [
  body('role')
    .custom(isValidRole)
    .withMessage('Role must be ' + Object.values(USER_ROLES).join(', ')),
  body('permissions')
    .optional()
    .isArray()
    .withMessage('Permissions must be an array'),
  handleValidationErrors
];

// Attendance validation
const validatePunchIn = [
  body('location')
    .isObject()
    .withMessage('Location is required'),
  body('location.latitude')
    .custom(isValidCoordinate)
    .withMessage('Valid latitude is required'),
  body('location.longitude')
    .custom(isValidCoordinate)
    .withMessage('Valid longitude is required'),
  body('location.accuracy')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Accuracy must be a positive number'),
  body('location.address')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Address must be less than 200 characters'),
  body('biometricData')
    .optional()
    .isObject()
    .withMessage('Biometric data must be an object'),
  handleValidationErrors
];

const validatePunchOut = [
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  body('location.latitude')
    .optional()
    .custom(isValidCoordinate)
    .withMessage('Valid latitude is required'),
  body('location.longitude')
    .optional()
    .custom(isValidCoordinate)
    .withMessage('Valid longitude is required'),
  body('workSummary')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Work summary must be less than 500 characters'),
  handleValidationErrors
];

const validateAttendanceQuery = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('status')
    .optional()
    .custom(isValidAttendanceStatus)
    .withMessage('Status must be present, absent, partial, or late'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

// Task validation
const validateTaskSlotUpdate = [
  body('slot')
    .custom(isValidTimeSlot)
    .withMessage('Slot must be morning, afternoon, or evening'),
  body('tasks')
    .isArray({ min: 1 })
    .withMessage('Tasks must be a non-empty array'),
  body('tasks.*.taskId')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Task ID is required'),
  body('tasks.*.completed')
    .isBoolean()
    .withMessage('Completed must be a boolean'),
  body('tasks.*.notes')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Notes must be less than 200 characters'),
  handleValidationErrors
];

const validateTaskBulkUpdate = [
  body('updates')
    .isArray({ min: 1 })
    .withMessage('Updates must be a non-empty array'),
  body('updates.*.slot')
    .custom(isValidTimeSlot)
    .withMessage('Slot must be morning, afternoon, or evening'),
  body('updates.*.tasks')
    .isArray()
    .withMessage('Tasks must be an array'),
  handleValidationErrors
];

const validateTaskQuery = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('status')
    .optional()
    .custom(isValidTaskStatus)
    .withMessage('Status must be not_started, in_progress, completed, or overdue'),
  query('minCompliance')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Minimum compliance must be between 0 and 100'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

const validateTaskReview = [
  body('approved')
    .isBoolean()
    .withMessage('Approved must be a boolean'),
  body('reviewNotes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Review notes must be less than 500 characters'),
  body('feedback')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Feedback must be less than 1000 characters'),
  handleValidationErrors
];

// Dashboard validation
const validateDashboardQuery = [
  query('period')
    .optional()
    .isIn(['week', 'month', 'quarter'])
    .withMessage('Period must be week, month, or quarter'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  handleValidationErrors
];

// File upload validation
const validateFileUpload = [
  body('fileType')
    .optional()
    .isIn(['profile', 'biometric', 'document'])
    .withMessage('File type must be profile, biometric, or document'),
  handleValidationErrors
];

// Biometric validation
const validateBiometricEnrollment = [
  body('biometricType')
    .isIn(['fingerprint', 'face', 'voice'])
    .withMessage('Biometric type must be fingerprint, face, or voice'),
  body('biometricData')
    .isObject()
    .withMessage('Biometric data is required'),
  body('biometricData.template')
    .isString()
    .isLength({ min: 10 })
    .withMessage('Biometric template is required'),
  body('biometricData.quality')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Quality score must be between 0 and 100'),
  handleValidationErrors
];

// Location validation
const validateLocationUpdate = [
  body('latitude')
    .custom(isValidCoordinate)
    .withMessage('Valid latitude is required'),
  body('longitude')
    .custom(isValidCoordinate)
    .withMessage('Valid longitude is required'),
  body('accuracy')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Accuracy must be a positive number'),
  body('timestamp')
    .optional()
    .isISO8601()
    .withMessage('Timestamp must be a valid ISO 8601 date'),
  handleValidationErrors
];

// Search and filter validation
const validateSearchQuery = [
  query('q')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search query must be between 1 and 100 characters'),
  query('type')
    .optional()
    .isIn(['users', 'attendance', 'tasks', 'all'])
    .withMessage('Search type must be users, attendance, tasks, or all'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  handleValidationErrors
];

// Date range validation
const validateDateRange = [
  query('startDate')
    .isISO8601()
    .withMessage('Start date is required and must be a valid ISO 8601 date'),
  query('endDate')
    .isISO8601()
    .withMessage('End date is required and must be a valid ISO 8601 date')
    .custom((endDate, { req }) => {
      const start = new Date(req.query.startDate);
      const end = new Date(endDate);
      if (end <= start) {
        throw new Error('End date must be after start date');
      }
      // Limit date range to 1 year
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      if (end - start > oneYear) {
        throw new Error('Date range cannot exceed 1 year');
      }
      return true;
    }),
  handleValidationErrors
];

// Pagination validation
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('sortBy')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Sort field must be between 1 and 50 characters'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc'),
  handleValidationErrors
];

// Export all validation middleware
module.exports = {
  // Authentication
  validateRegister,
  validateLogin,
  validatePasswordReset,
  validatePasswordUpdate,
  
  // Users
  validateUserId,
  validateUserUpdate,
  validateRoleAssignment,
  
  // Attendance
  validatePunchIn,
  validatePunchOut,
  validateAttendanceQuery,
  
  // Tasks
  validateTaskSlotUpdate,
  validateTaskBulkUpdate,
  validateTaskQuery,
  validateTaskReview,
  
  // Dashboard
  validateDashboardQuery,
  
  // Files
  validateFileUpload,
  
  // Biometric
  validateBiometricEnrollment,
  
  // Location
  validateLocationUpdate,
  
  // Search
  validateSearchQuery,
  
  // Common
  validateDateRange,
  validatePagination,
  
  // Utility
  handleValidationErrors,
  
  // Custom validators
  isValidObjectId,
  isValidCoordinate,
  isValidTimeSlot,
  isValidRole,
  isValidAttendanceStatus,
  isValidTaskStatus
};