const crypto = require('crypto');
const config = require('../config/config');

// Đảm bảo key có đúng 32 bytes (256 bits)
const KEY = crypto.createHash('sha256').update(config.ENCRYPTION_KEY).digest();
const IV_LENGTH = 16;

/**
 * Mã hóa chuỗi mật khẩu
 */
function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Lỗi mã hóa:', error);
    return text;
  }
}

/**
 * Giải mã chuỗi mật khẩu
 */
function decrypt(text) {
  if (!text) return '';
  if (!text.includes(':')) {
    // Nếu text chưa mã hóa (dữ liệu cũ/plain)
    return text;
  }
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Lỗi giải mã:', error);
    return text;
  }
}

module.exports = {
  encrypt,
  decrypt
};
