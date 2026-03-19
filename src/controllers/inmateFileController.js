const InmateFile = require("../model/InmateFile");


const uploadInmateFiles = async ({ filesObj, remarks }) => {
  const savedFiles = [];

  try {
    // multiple files
    if (filesObj.files) {
      for (const file of filesObj.files) {
        const doc = await InmateFile.create({
          fileUrl: file.path,
          fileType: file.mimetype,
          remarks
        });
        savedFiles.push(doc);
      }
    }

    // profile picture
    if (filesObj.pro_pic && filesObj.pro_pic[0]) {
      const file = filesObj.pro_pic[0];
      const doc = await InmateFile.create({
        fileUrl: file.path,
        fileType: file.mimetype,
        remarks: "Profile picture"
      });
      savedFiles.push(doc);
    }

    return {
      status: true,
      message: "Files uploaded successfully",
      data: savedFiles
    };
  } catch (error) {
    return {
      status: false,
      message: `Upload failed (${error.message})`
    };
  }
};

exports.fileUploadController = async (req, res) => {
  try {
    const { inmateId, remarks } = req.body;

    const result = await uploadInmateFiles({
      filesObj: req.files,
      remarks
    });

    if (!result.status) {
      return res.status(400).json(result);
    }

    return res.status(201).json(result);

  } catch (error) {
    console.error("File upload controller error:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error"
    });
  }
};
