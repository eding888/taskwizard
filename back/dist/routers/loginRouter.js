import express from 'express';
import bcrypt from 'bcrypt';
import { genRefreshToken, genAuthToken, genEmailCode, verifyToken } from '../utils/genToken.js';
import { sendConfirmationEmail, checkSanitizedInput, passwordToHash, MailType } from '../utils/routerHelper.js';
import jwt from 'jsonwebtoken';
import config from '../utils/config.js';
import User from '../models/user.js';
const loginRouter = express.Router();
const sendEmailWithCode = async (email, mailType, subject) => {
    const code = genEmailCode();
    const response = await sendConfirmationEmail(email, mailType, subject, code.digits);
    if (response === null) {
        return null;
    }
    else {
        return code.token;
    }
};
loginRouter.post('/', async (request, response) => {
    const { username, password } = request.body;
    if (username && password) {
        if (!checkSanitizedInput(username, 'none')) {
            return response.status(400).json({
                error: 'improper formatting of username'
            });
        }
        const user = await User.findOne({ username });
        if (!user) {
            return response.status(401).json({
                error: 'invalid username'
            });
        }
        const passwordCorrect = user === null
            ? false
            : await bcrypt.compare(password, user.passwordHash);
        if (!passwordCorrect) {
            return response.status(401).json({
                error: 'invalid password'
            });
        }
        if (!user.isVerified) {
            const codeToken = await sendEmailWithCode(user.email, MailType.verifyUser, 'Confirm your HeelsMart account.');
            if (codeToken === null) {
                return response.status(500).json({
                    error: 'error with sending email'
                });
            }
            user.emailCode = codeToken;
            await user.save();
            return response.status(401).json({
                error: 'user is not verified'
            });
        }
        if (!user.refreshToken || !verifyToken(user.refreshToken)) {
            user.refreshToken = genRefreshToken();
            await user.save();
        }
        const authToken = await genAuthToken(user.username, user.passwordHash);
        response.status(200).json({ token: authToken });
    }
    else {
        return response.status(400).json({
            error: 'no username/password provided'
        });
    }
});
loginRouter.post('/confirm', async (request, response) => {
    const { code } = request.body;
    if (!request.user) {
        return response.status(401).json({
            error: 'user or token not found'
        });
    }
    if (!request.user.emailCode) {
        return response.status(400).json({
            error: 'user has no email code'
        });
    }
    const userCode = jwt.verify(request.user.emailCode, config.SECRET).code;
    if (userCode !== code) {
        return response.status(401).json({
            error: 'code does not match'
        });
    }
    request.user.isVerified = true;
    request.user.refreshToken = genRefreshToken();
    const savedUser = await request.user.save();
    response.status(200).json(savedUser);
});
loginRouter.post('/resetPassword', async (request, response) => {
    const { email } = request.body;
    if (!email) {
        return response.status(400).json({
            error: 'email not provided'
        });
    }
    if (!checkSanitizedInput(email, 'email')) {
        return response.status(400).json({
            error: 'email not properly formatted'
        });
    }
    const user = await User.findOne({ email });
    if (!user) {
        return response.status(400).json({
            error: 'email not found in system'
        });
    }
    const date = new Date();
    const time = date.getTime();
    if (user.passResetCooldown && user.passResetCooldown > time) {
        return response.status(400).json({
            error: 'user still on password reset cooldown'
        });
    }
    const resetCodeToken = await sendEmailWithCode(email, MailType.resetPassword, 'Confirm your HeelsMart password change.');
    if (resetCodeToken === null) {
        return response.status(500).json({
            error: 'error with sending email'
        });
    }
    user.passResetCode = resetCodeToken;
    user.passResetAttempts = 5;
    await user.save();
    response.status(200).end();
});
loginRouter.post('/resetPassword/confirm', async (request, response) => {
    const { email, code, newPassword } = request.body;
    if (!email || !code || !newPassword) {
        return response.status(400).json({
            error: 'email not provided'
        });
    }
    if (!checkSanitizedInput(email, 'email')) {
        return response.status(400).json({
            error: 'email not properly formatted'
        });
    }
    const user = await User.findOne({ email });
    if (!user) {
        return response.status(400).json({
            error: 'email not found in system'
        });
    }
    if (!user.passResetCode) {
        return response.status(400).json({
            error: 'user has no password reset code'
        });
    }
    const date = new Date();
    const time = date.getTime();
    if (user.passResetCooldown && user.passResetCooldown > time) {
        return response.status(400).json({
            error: 'user still on password reset cooldown'
        });
    }
    const userCode = jwt.verify(user.passResetCode, config.SECRET).code;
    if (!user.passResetAttempts) {
        return response.status(400).json({
            error: 'user does not have password reset attempts'
        });
    }
    if (userCode !== code) {
        if (user.passResetAttempts <= 1) {
            user.passResetAttempts = null;
            user.passResetCooldown = time + (60 * 60 * 1000);
            await user.save();
            return response.status(401).json({
                error: 'user has ran out of password reset attempts'
            });
        }
        user.passResetAttempts = user.passResetAttempts - 1;
        await user.save();
        return response.status(401).json({
            error: 'code does not match'
        });
    }
    const passwordHashDetails = await passwordToHash(newPassword);
    if (passwordHashDetails.errors) {
        return response.status(400).json({
            errors: passwordHashDetails.errors
        });
    }
    const passwordHash = passwordHashDetails.password;
    if (!passwordHash) {
        return response.status(500).json({
            error: 'error in generating hash'
        });
    }
    user.passwordHash = passwordHash;
    await user.save();
    response.status(200).end();
});
export default loginRouter;
