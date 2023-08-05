import jwt from 'jsonwebtoken';
import config from './config.js';
import User from '../models/user.js';
import { verifyToken, genAuthToken } from './genToken.js';
const errorHandler = (error, request, response, next) => {
    console.log(error.message);
    if (error.name === 'CastError') {
        return response.status(400).send({ error: 'malformatted id' });
    }
    else if (error.name === 'ValidationError') {
        return response.status(400).json({ error: error.message });
    }
    else if (error.name === 'JsonWebTokenError') {
        return response.status(400).json({ error: error.message });
    }
    next(error);
};
// Will acquire the token from headers and checks if its valid. If it is, it updates request.token.
// If not, it will decode that token, check the user it came from for a refresh token, and if refresh token
// is valid, a new auth token will simply be provided.
const getTokenFrom = async (request, response, next) => {
    const authorization = request.get('Authorization');
    if (authorization && authorization.startsWith('bearer ')) {
        const token = authorization.replace('bearer ', '');
        if (token !== 'undefined') {
            if (verifyToken(token)) {
                request.token = token;
            }
            else {
                let expiredToken;
                try {
                    expiredToken = jwt.decode(token);
                }
                catch (error) {
                    return response.status(401).json({ error: 'token invalid' }); // token is nonsense
                }
                const id = expiredToken._id;
                if (!id || !expiredToken.username) {
                    return response.status(401).json({ error: 'token invalid' }); // token may be user, but is formatted wrong
                }
                const user = await User.findById(id);
                if (!user.isVerified) {
                    user.deleteOne();
                    return response.status(400).json({ error: 'starter auth token expired' }); // gets rid of users who create accounts but never verifies them
                }
                if (user.refreshToken !== null && (!verifyToken(user.refreshToken) || !user.username)) {
                    return response.status(400).json({ error: 'refresh token expired' });
                }
                const newToken = await genAuthToken(user.username);
                request.token = newToken;
                // NEW AUTH TOKEN GENERATED, BE SURE TO CATCH THIS IN FRONTEND TO STORE IN COOKIE
                response.setHeader('Authorization', newToken);
            }
        }
    }
    next();
};
const getUserFromToken = async (request, response, next) => {
    try {
        if (request.token) {
            const decodedToken = jwt.verify(request.token, config.SECRET);
            const id = decodedToken._id;
            if (!id) {
                return response.status(401).json({ error: 'token invalid' });
            }
            request.user = await User.findById(id);
        }
    }
    catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            return response.status(400).json({ error: 'invalid token' });
        }
        else if (error instanceof jwt.TokenExpiredError) {
            return response.status(401).json({ error: 'token expired' });
        }
        else {
            return response.status(500).json({ error: 'internal server error' });
        }
    }
    next();
};
export default { errorHandler, getTokenFrom, getUserFromToken };
