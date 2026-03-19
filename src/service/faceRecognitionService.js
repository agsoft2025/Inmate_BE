const UserSchema = require("../model/userModel");
exports.faceRecognitionService = async (descriptor) => {
    const allUsers = await UserSchema.find({}, { descriptor: 1, username: 1, role: 1, fullname: 1 });
    function euclideanDistance(desc1, desc2) {
        let sum = 0;
        for (let i = 0; i < desc1.length; i++) {
            let diff = desc1[i] - desc2[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }
    let bestMatch = null;
    let minDistance = Infinity;

    for (const user of allUsers) {
        if (!user.descriptor || user.descriptor.length !== descriptor.length) continue;

        const dist = euclideanDistance(user.descriptor, descriptor);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = user;
        }
    }
    const MATCH_THRESHOLD = 0.4;

    if (!bestMatch || minDistance > MATCH_THRESHOLD) {
        return { status: false, message: "Face not matched" }
    } else {
        return { status: true,username:bestMatch.username, message: "Face matched" }
    }
}

exports.faceRecognitionExcludeUserService = async (descriptor, user_id) => {
    const allUsers = await UserSchema.find(
        { _id: { $ne: user_id } },
        { descriptor: 1, username: 1, role: 1, fullname: 1 }
    );
    function euclideanDistance(desc1, desc2) {
        let sum = 0;
        for (let i = 0; i < desc1.length; i++) {
            let diff = desc1[i] - desc2[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }
    let bestMatch = null;
    let minDistance = Infinity;

    for (const user of allUsers) {
        if (!user.descriptor || user.descriptor.length !== descriptor.length) continue;

        const dist = euclideanDistance(user.descriptor, descriptor);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = user;
        }
    }
    const MATCH_THRESHOLD = 0.4;
    
    if (!bestMatch || minDistance > MATCH_THRESHOLD) {
        return { status: false, message: "Face not matched" }
    } else {
        return { status: true,username:bestMatch.username, message: "Face matched" }
    }
}