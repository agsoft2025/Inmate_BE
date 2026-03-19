const mongoose = require('mongoose');

exports.dbConnect = async () => {
   await mongoose.connect(process.env.DB_MONGO_URL).then(() => {
        console.log("Mongo db connected succesfully");
    }).catch((err)=>{
        console.log("mongo db connection error",err);
    })
}