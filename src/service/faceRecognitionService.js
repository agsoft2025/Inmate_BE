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

// --- Face-recognition account-takeover fix -------------------------------
//
// The functions above answer "does this descriptor already match *someone*"
// (used to block duplicate face registrations). They are deliberately left
// untouched. Authentication/identification is a different, higher-stakes
// question - "who, if anyone, does this descriptor confidently belong to" -
// and a bare nearest-neighbor lookup isn't a safe way to answer it: if two
// enrolled users both happen to be within (or near) the match threshold of
// the presented face, silently picking whichever is a hair closer means an
// attacker only needs to be "close enough" to someone, not a genuine match,
// to be authenticated/identified as them. resolveFaceMatch() is the shared,
// ambiguity-aware resolver used everywhere a face is matched against many
// candidates for authentication or identification (login, POS fetch-by-face).
const MATCH_THRESHOLD = 0.4;
// If a second candidate's distance falls within this band above the match
// threshold, the best match is treated as ambiguous rather than trusted -
// two candidates that are both plausible matches for the same presented
// face should never be resolved by picking whichever is marginally closer.
const AMBIGUITY_BAND = 0.08;

function euclideanDistance(desc1, desc2) {
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
        const diff = desc1[i] - desc2[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

exports.resolveFaceMatch = (descriptor, candidates, options = {}) => {
    const threshold = options.threshold ?? MATCH_THRESHOLD;
    const ambiguityBand = options.ambiguityBand ?? AMBIGUITY_BAND;

    let bestMatch = null;
    let bestDistance = Infinity;
    let secondBestDistance = Infinity;

    for (const candidate of candidates || []) {
        if (!candidate.descriptor || candidate.descriptor.length !== descriptor.length) continue;

        const dist = euclideanDistance(candidate.descriptor, descriptor);
        if (dist < bestDistance) {
            secondBestDistance = bestDistance;
            bestDistance = dist;
            bestMatch = candidate;
        } else if (dist < secondBestDistance) {
            secondBestDistance = dist;
        }
    }

    if (!bestMatch || bestDistance > threshold) {
        return {
            matched: false,
            ambiguous: false,
            bestMatch,
            distance: bestMatch ? bestDistance : null,
        };
    }

    // A runner-up close enough to also plausibly be "the" match means we
    // can't be confident which account the presented face belongs to.
    if (secondBestDistance <= threshold + ambiguityBand) {
        return {
            matched: false,
            ambiguous: true,
            bestMatch,
            distance: bestDistance,
            secondBestDistance,
        };
    }

    return {
        matched: true,
        ambiguous: false,
        bestMatch,
        distance: bestDistance,
        secondBestDistance,
    };
};