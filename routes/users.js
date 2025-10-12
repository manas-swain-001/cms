const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { User } = require('../models/User');
const { auth, authorize, checkPermission, selfOrAdmin, managerAccess, auditLog } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users with filtering and pagination
// @access  Private (Admin/Manager)
router.get('/', [
  auth,
  authorize('admin', 'manager'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('role').optional().isIn(['admin', 'manager', 'developer', 'sales', 'field']).withMessage('Invalid role'),
  query('office').optional().isIn(['bhubaneswar', 'mumbai', 'bangalore', 'delhi']).withMessage('Invalid office'),
  query('isActive').optional().isBoolean().withMessage('isActive must be boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      page = 1,
      limit = 10,
      search,
      role,
      office,
      department,
      isActive,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    
    // Role-based filtering
    if (req.user.role === 'manager') {
      // Managers can only see users from their office and department
      filter.office = req.user.office;
      filter.department = req.user.department;
    }
    
    if (role) filter.role = role;
    if (office && req.user.role === 'admin') filter.office = office;
    if (department) filter.department = department;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    // Search functionality
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const allUsers = await User.find(filter);
    const total = allUsers.length;
    
    // Apply sorting
    allUsers.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      const order = sortOrder === 'desc' ? -1 : 1;
      
      if (aVal < bVal) return -1 * order;
      if (aVal > bVal) return 1 * order;
      return 0;
    });
    
    // Apply pagination
    const users = allUsers.slice(skip, skip + parseInt(limit)).map(user => {
      const userObj = { ...user };
      delete userObj.password;
      delete userObj.refreshTokens;
      delete userObj.biometricData?.faceEncoding;
      delete userObj.biometricData?.fingerprintHash;
      return userObj;
    });

    // Calculate pagination info
    const totalPages = Math.ceil(total / parseInt(limit));
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalUsers: total,
          hasNextPage,
          hasPrevPage,
          limit: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
});

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private (Self/Admin/Manager)
router.get('/:id', [auth, managerAccess], async (req, res) => {
  try {
    const user = User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const userObj = { ...user };
    delete userObj.password;
    delete userObj.refreshTokens;
    delete userObj.biometricData?.faceEncoding;
    delete userObj.biometricData?.fingerprintHash;

    res.json({
      success: true,
      data: { user: userObj }
    });
  } catch (error) {
    console.error('Get user error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user'
    });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private (Self/Admin)
router.put('/:id', [
  auth,
  selfOrAdmin,
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('role').optional().isIn(['admin', 'manager', 'developer', 'sales', 'field']).withMessage('Invalid role'),
  body('office').optional().isIn(['bhubaneswar', 'mumbai', 'bangalore', 'delhi']).withMessage('Invalid office'),
  auditLog('UPDATE_USER')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.params.id;
    const updates = req.body;
    
    // Remove sensitive fields that shouldn't be updated via this route
    delete updates.password;
    delete updates.refreshTokens;
    delete updates.biometricData;
    delete updates.loginAttempts;
    delete updates.accountLocked;
    
    // Only admin can update role and certain fields
    if (req.user.role !== 'admin') {
      delete updates.role;
      delete updates.permissions;
      delete updates.isActive;
      delete updates.emailVerified;
    }
    
    // Users can only update their own profile (except admin)
    if (req.user.role !== 'admin' && req.user._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own profile'
      });
    }

    const user = User.findByIdAndUpdate(userId, { ...updates, updatedAt: new Date() });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const userObj = { ...user };
    delete userObj.password;
    delete userObj.refreshTokens;
    delete userObj.biometricData?.faceEncoding;
    delete userObj.biometricData?.fingerprintHash;

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: userObj }
    });
  } catch (error) {
    console.error('Update user error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email or employee ID already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while updating user'
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete user (soft delete)
// @access  Private (Admin only)
router.delete('/:id', [
  auth,
  authorize('admin'),
  auditLog('DELETE_USER')
], async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Prevent admin from deleting themselves
    if (req.user._id.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    const user = User.findByIdAndUpdate(userId, {
      isActive: false,
      deletedAt: new Date(),
      refreshTokens: [] // Clear all sessions
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting user'
    });
  }
});

// @route   POST /api/users/:id/upload-profile-image
// @desc    Upload profile image
// @access  Private (Self/Admin)
router.post('/:id/upload-profile-image', [
  auth,
  selfOrAdmin,
  upload.profileImage,
  upload.addFileInfo
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const userId = req.params.id;
    const imageUrl = upload.getFileUrl(req.file.filename, 'profiles');
    
    // Delete old profile image if exists
    const user = User.findById(userId);
    if (user && user.profileImage) {
      const oldImagePath = user.profileImage.replace('/api/uploads/profiles/', '');
      upload.deleteFile(path.join(upload.uploadDirs.profiles, oldImagePath));
    }

    // Update user with new profile image
    const updatedUser = User.findByIdAndUpdate(userId, {
      profileImage: imageUrl,
      updatedAt: new Date()
    });
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const userObj = { ...updatedUser };
    delete userObj.password;
    delete userObj.refreshTokens;
    delete userObj.biometricData?.faceEncoding;
    delete userObj.biometricData?.fingerprintHash;

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        user: userObj,
        imageUrl
      }
    });
  } catch (error) {
    console.error('Upload profile image error:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      upload.deleteFile(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while uploading profile image'
    });
  }
});

// @route   POST /api/users/:id/enroll-biometric
// @desc    Enroll biometric data
// @access  Private (Self/Admin)
router.post('/:id/enroll-biometric', [
  auth,
  selfOrAdmin,
  upload.biometricImage,
  upload.addFileInfo
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No biometric image provided'
      });
    }

    const userId = req.params.id;
    const { biometricType = 'face' } = req.body;
    
    // TODO: Process biometric image and extract features
    // For now, just store the image path
    
    const biometricData = {
      isEnrolled: true,
      enrolledAt: new Date(),
      biometricType,
      imagePath: req.file.path,
      // In production, store processed biometric features here
      faceEncoding: 'mock_face_encoding_data',
      fingerprintHash: biometricType === 'fingerprint' ? 'mock_fingerprint_hash' : undefined
    };

    const user = User.findByIdAndUpdate(userId, {
      biometricData,
      updatedAt: new Date()
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const userObj = { ...user };
    delete userObj.password;
    delete userObj.refreshTokens;
    delete userObj.biometricData?.faceEncoding;
    delete userObj.biometricData?.fingerprintHash;

    res.json({
      success: true,
      message: 'Biometric enrollment successful',
      data: {
        user: userObj,
        biometricType
      }
    });
  } catch (error) {
    console.error('Biometric enrollment error:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      upload.deleteFile(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during biometric enrollment'
    });
  }
});

// @route   GET /api/users/stats/overview
// @desc    Get user statistics overview
// @access  Private (Admin/Manager)
router.get('/stats/overview', [auth, authorize('admin', 'manager')], async (req, res) => {
  try {
    const filter = {};
    
    // Managers can only see stats from their office
    if (req.user.role === 'manager') {
      filter.office = req.user.office;
    }

    const allUsers = User.find(filter);
    const totalUsers = allUsers.length;
    const activeUsers = allUsers.filter(user => user.isActive).length;
    
    // Calculate role distribution
    const roleStats = allUsers.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});
    
    // Calculate office distribution
    const officeStats = allUsers.reduce((acc, user) => {
      acc[user.office] = (acc[user.office] || 0) + 1;
      return acc;
    }, {});

    const stats = {
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      roleDistribution: roleStats,
      officeDistribution: officeStats
    };

    res.json({
      success: true,
      data: { stats }
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user statistics'
    });
  }
});

// @route   PUT /api/users/:id/toggle-status
// @desc    Toggle user active status
// @access  Private (Admin only)
router.put('/:id/toggle-status', [
  auth,
  authorize('admin'),
  auditLog('TOGGLE_USER_STATUS')
], async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Prevent admin from deactivating themselves
    if (req.user._id.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    const user = User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updatedUser = User.findByIdAndUpdate(userId, {
      isActive: !user.isActive,
      refreshTokens: !user.isActive ? [] : user.refreshTokens
    });
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: `User ${updatedUser.isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        userId: updatedUser._id,
        isActive: updatedUser.isActive
      }
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while toggling user status'
    });
  }
});

module.exports = router;