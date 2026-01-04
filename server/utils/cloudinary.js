import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import path from "path";
dotenv.config({});

cloudinary.config({
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
  cloud_name: process.env.CLOUD_NAME,
});

export const uploadMedia = async (file, isPdf = false) => {
  try {
    const options = {
      resource_type: isPdf ? "raw" : "auto",
      access_mode: "public",
    };

    if (typeof file === "string") {
      const resolved = path.resolve(file);
      return await cloudinary.uploader.upload(resolved, options);
    }

    if (file && typeof file === "object" && file.path) {
      const resolved = path.resolve(file.path);
      return await cloudinary.uploader.upload(resolved, options);
    }

    if (file && typeof file === "object" && file.buffer && file.mimetype) {
      const fileUri = `data:${file.mimetype};base64,${file.buffer.toString(
        "base64"
      )}`;
      return await cloudinary.uploader.upload(fileUri, options);
    }

    throw new Error("Invalid file input for uploadMedia");
  } catch (error) {
    console.log(error);
    return null;
  }
};

export const deleteMediaFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.log(error);
  }
};

export const deleteVideoFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "video" });
  } catch (error) {
    console.log(error);
  }
};
export const deletePdfFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
  } catch (error) {
    console.log(error);
  }
};
