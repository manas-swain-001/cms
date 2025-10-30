/**
 * Date/Time Utility Functions for Indian Standard Time (IST - UTC+5:30)
 * All dates in the application should be stored and calculated in IST
 */

/**
 * Get current date/time in IST
 * @returns {Date} Current date/time in IST
 */
const getCurrentISTTime = () => {
  const now = new Date();
  // Convert to IST (UTC + 5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utcTime + istOffset);
};

/**
 * Convert any date to IST
 * @param {Date|string} date - Date to convert
 * @returns {Date} Date in IST
 */
const toIST = (date) => {
  const inputDate = new Date(date);
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcTime = inputDate.getTime() + (inputDate.getTimezoneOffset() * 60 * 1000);
  return new Date(utcTime + istOffset);
};

/**
 * Get start of day in IST (00:00:00)
 * @param {Date} date - Date to get start of day for (optional, defaults to today)
 * @returns {Date} Start of day in IST
 */
const getISTStartOfDay = (date = null) => {
  const istDate = date ? toIST(date) : getCurrentISTTime();
  istDate.setHours(0, 0, 0, 0);
  return istDate;
};

/**
 * Get end of day in IST (23:59:59.999)
 * @param {Date} date - Date to get end of day for (optional, defaults to today)
 * @returns {Date} End of day in IST
 */
const getISTEndOfDay = (date = null) => {
  const istDate = date ? toIST(date) : getCurrentISTTime();
  istDate.setHours(23, 59, 59, 999);
  return istDate;
};

/**
 * Parse date from dd/mm/yyyy format and return IST date
 * @param {string} dateStr - Date string in dd/mm/yyyy format
 * @returns {Date|null} Parsed date in IST or null if invalid
 */
const parseDateDDMMYYYY = (dateStr) => {
  if (!dateStr) return null;
  
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  
  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1; // Month is 0-indexed
  const year = parseInt(parts[2]);
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1900) return null;
  
  // Create date in IST
  const istDate = new Date(year, month, day);
  return toIST(istDate);
};

/**
 * Format date to dd/mm/yyyy
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
const formatDateDDMMYYYY = (date) => {
  if (!date) return '';
  const istDate = toIST(date);
  const day = String(istDate.getDate()).padStart(2, '0');
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const year = istDate.getFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * Format date to dd/mm/yyyy HH:MM:SS
 * @param {Date} date - Date to format
 * @returns {string} Formatted date and time string
 */
const formatDateTimeDDMMYYYY = (date) => {
  if (!date) return '';
  const istDate = toIST(date);
  const day = String(istDate.getDate()).padStart(2, '0');
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const year = istDate.getFullYear();
  const hours = String(istDate.getHours()).padStart(2, '0');
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  const seconds = String(istDate.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

/**
 * Get current IST time in HH:MM format
 * @returns {string} Current time in HH:MM format
 */
const getCurrentISTTimeString = () => {
  const istDate = getCurrentISTTime();
  const hours = String(istDate.getHours()).padStart(2, '0');
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

/**
 * Get current IST hour and minute
 * @returns {object} Object with hour and minute properties
 */
const getCurrentISTHourMinute = () => {
  const istDate = getCurrentISTTime();
  return {
    hour: istDate.getHours(),
    minute: istDate.getMinutes(),
    totalMinutes: istDate.getHours() * 60 + istDate.getMinutes()
  };
};

/**
 * Check if a date is today in IST
 * @param {Date} date - Date to check
 * @returns {boolean} True if date is today in IST
 */
const isToday = (date) => {
  const istDate = toIST(date);
  const today = getCurrentISTTime();
  return (
    istDate.getDate() === today.getDate() &&
    istDate.getMonth() === today.getMonth() &&
    istDate.getFullYear() === today.getFullYear()
  );
};

/**
 * Get today's date at 00:00:00 in IST
 * @returns {Date} Today's date at midnight IST
 */
const getTodayIST = () => {
  return getISTStartOfDay();
};

/**
 * Add days to a date in IST
 * @param {Date} date - Starting date
 * @param {number} days - Number of days to add
 * @returns {Date} New date in IST
 */
const addDays = (date, days) => {
  const istDate = toIST(date);
  istDate.setDate(istDate.getDate() + days);
  return istDate;
};

/**
 * Get difference between two dates in days
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} Difference in days
 */
const getDaysDifference = (date1, date2) => {
  const istDate1 = toIST(date1);
  const istDate2 = toIST(date2);
  const diffTime = Math.abs(istDate2 - istDate1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Get IST timezone offset string
 * @returns {string} IST timezone offset (+05:30)
 */
const getISTOffset = () => {
  return '+05:30';
};

/**
 * Create a Mongoose timestamp plugin for IST
 * This can be used in schemas to automatically use IST for timestamps
 */
const istTimestampPlugin = (schema) => {
  // Override the default timestamp behavior
  schema.pre('save', function(next) {
    const now = getCurrentISTTime();
    if (this.isNew) {
      this.createdAt = now;
    }
    this.updatedAt = now;
    next();
  });
};

module.exports = {
  getCurrentISTTime,
  toIST,
  getISTStartOfDay,
  getISTEndOfDay,
  parseDateDDMMYYYY,
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
  getCurrentISTTimeString,
  getCurrentISTHourMinute,
  isToday,
  getTodayIST,
  addDays,
  getDaysDifference,
  getISTOffset,
  istTimestampPlugin
};

