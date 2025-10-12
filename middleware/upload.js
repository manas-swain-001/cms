const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure upload directories exist
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Create upload directories
const uploadDirs = {
  profiles: path.join(__dirname, '../uploads/profiles'),
  biometric: path.join(__dirname, '../uploads/biometric'),
  documents: path.join(__dirname, '../uploads/documents'),
  temp: path.join(__dirname, '../uploads/temp')
};

// Ensure all directories exist
Object.values(uploadDirs).forEach(ensureDirectoryExists);

// File filter function
const fileFilter = (allowedTypes) => {
  return (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`), false);
    }
  };
};

// Generate unique filename
const generateFileName = (originalname) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const extension = path.extname(originalname);
  return `${timestamp}_${randomString}${extension}`;
};

// Storage configuration for profile images
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirs.profiles);
  },
  filename: (req, file, cb) => {
    const fileName = generateFileName(file.originalname);
    cb(null, fileName);
  }
});

// Storage configuration for biometric images
const biometricStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirs.biometric);
  },
  filename: (req, file, cb) => {
    const fileName = generateFileName(file.originalname);
    cb(null, fileName);
  }
});

// Storage configuration for documents
const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirs.documents);
  },
  filename: (req, file, cb) => {
    const fileName = generateFileName(file.originalname);
    cb(null, fileName);
  }
});

// Memory storage for temporary processing
const memoryStorage = multer.memoryStorage();

// File size limits (in bytes)
const fileLimits = {
  profile: 5 * 1024 * 1024,    // 5MB for profile images
  biometric: 10 * 1024 * 1024, // 10MB for biometric images
  document: 20 * 1024 * 1024   // 20MB for documents
};

// Allowed file types
const allowedTypes = {
  images: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  documents: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ],
  biometric: ['image/jpeg', 'image/jpg', 'image/png']
};

// Profile image upload middleware
const uploadProfileImage = multer({
  storage: profileStorage,
  limits: {
    fileSize: fileLimits.profile
  },
  fileFilter: fileFilter(allowedTypes.images)
});

// Biometric image upload middleware
const uploadBiometricImage = multer({
  storage: biometricStorage,
  limits: {
    fileSize: fileLimits.biometric
  },
  fileFilter: fileFilter(allowedTypes.biometric)
});

// Document upload middleware
const uploadDocument = multer({
  storage: documentStorage,
  limits: {
    fileSize: fileLimits.document
  },
  fileFilter: fileFilter([...allowedTypes.images, ...allowedTypes.documents])
});

// General upload middleware with memory storage
const uploadToMemory = multer({
  storage: memoryStorage,
  limits: {
    fileSize: fileLimits.biometric // Use largest limit for flexibility
  },
  fileFilter: fileFilter([...allowedTypes.images, ...allowedTypes.documents])
});

// Multiple files upload middleware
const uploadMultiple = multer({
  storage: documentStorage,
  limits: {
    fileSize: fileLimits.document,
    files: 10 // Maximum 10 files
  },
  fileFilter: fileFilter([...allowedTypes.images, ...allowedTypes.documents])
});

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large. Please upload a smaller file.',
          error: 'FILE_TOO_LARGE'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files. Maximum 10 files allowed.',
          error: 'TOO_MANY_FILES'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Unexpected file field.',
          error: 'UNEXPECTED_FILE'
        });
      default:
        return res.status(400).json({
          success: false,
          message: 'File upload error.',
          error: error.code
        });
    }
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: error.message,
      error: 'INVALID_FILE_TYPE'
    });
  }
  
  next(error);
};

// File cleanup utility
const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
  return false;
};

// Clean up old files (utility function)
const cleanupOldFiles = (directory, maxAgeInDays = 30) => {
  try {
    const files = fs.readdirSync(directory);
    const maxAge = maxAgeInDays * 24 * 60 * 60 * 1000; // Convert to milliseconds
    const now = Date.now();
    
    files.forEach(file => {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        deleteFile(filePath);
        console.log(`Deleted old file: ${file}`);
      }
    });
  } catch (error) {
    console.error('Error cleaning up old files:', error);
  }
};

// Validate image dimensions (middleware)
const validateImageDimensions = (minWidth = 100, minHeight = 100, maxWidth = 4000, maxHeight = 4000) => {
  return async (req, res, next) => {
    if (!req.file || !req.file.mimetype.startsWith('image/')) {
      return next();
    }
    
    try {
      // This would require sharp or similar library for actual implementation
      // For now, just pass through
      next();
    } catch (error) {
      console.error('Error validating image dimensions:', error);
      next();
    }
  };
};

// Get file URL helper
const getFileUrl = (filename, type = 'profiles') => {
  if (!filename) return null;
  return `/api/uploads/${type}/${filename}`;
};

// File info middleware (adds file info to request)
const addFileInfo = (req, res, next) => {
  if (req.file) {
    req.fileInfo = {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path,
      url: getFileUrl(req.file.filename, req.uploadType || 'profiles')
    };
  }
  
  if (req.files && Array.isArray(req.files)) {
    req.filesInfo = req.files.map(file => ({
      originalName: file.originalname,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      path: file.path,
      url: getFileUrl(file.filename, req.uploadType || 'documents')
    }));
  }
  
  next();
};

module.exports = {
  // Single file uploads
  single: uploadToMemory.single.bind(uploadToMemory),
  
  // Specific upload types
  profileImage: uploadProfileImage.single('profileImage'),
  biometricImage: uploadBiometricImage.single('biometricImage'),
  document: uploadDocument.single('document'),
  
  // Multiple files
  multiple: uploadMultiple.array('files'),
  
  // Memory storage
  memory: uploadToMemory,
  
  // Middleware
  handleUploadError,
  validateImageDimensions,
  addFileInfo,
  
  // Utilities
  deleteFile,
  cleanupOldFiles,
  getFileUrl,
  
  // Constants
  uploadDirs,
  allowedTypes,
  fileLimits
};