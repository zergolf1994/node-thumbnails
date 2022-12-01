"use strict";
const request = require("request-promise");
const http = require("http");
const fs = require("fs-extra");
const path = require("path");
const Files = require("../modules/Mysql/Files");
const Storages = require("../modules/Mysql/Storage");
const Servers = require("../modules/Mysql/Servers");
const Progress = require("../modules/Mysql/Progress");
const FilesVideo = require("../modules/Mysql/FilesVideo");
const FilesThumb = require("../modules/Mysql/FilesThumb");
const { Sequelize, Op } = require("sequelize");
const moment = require("moment");
const sizeOf = require("image-size");
const mergeImg = require("merge-img");
const shell = require("shelljs");
const Jimp = require("jimp");

module.exports = async (req, res) => {
  const { slug } = req.query;

  let sv_ip,
    duration,
    token,
    quality,
    width = 120,
    height = 0,
    imgdir,
    file_slug,
    IntervalPerImage,
    totalImages,
    totalSpirits = 1,
    rowCount = 1000,
    colCount = 10,
    table = [],
    table_c = [],
    links = [],
    linksY = [];

  const g_folder = "1gHVDkmoXtAYQ-hHro175eXyNmV3L-vEq";

  try {
    if (!slug) return res.json({ status: false, msg: "not_slug" });
    file_slug = slug;
    // เช็ค Progress
    const process = await Progress.findOne({
      raw: true,
      where: {
        slug: slug,
        type: "thumbnails",
      },
    });
    if (!process) return res.json({ status: false, msg: "not_process" });
    // เช็ค files_thumbs
    const thumbs = await FilesThumb.findOne({
      where: { slug: slug },
    });

    if (thumbs) return res.json({ status: false, msg: "has_thumbs" });
    //เช็คเวลาไฟล์
    const file = await Files.findOne({
      where: { slug: slug },
    });
    if (!file) return res.json({ status: false, msg: "not_file" });
    //ค้นหาไฟล์ video
    const video = await FilesVideo.findOne({
      where: { slug: slug, sv_id: { [Op.ne]: 0 } },
    });
    if (!video) return res.json({ status: false, msg: "not_video" });
    token = video?.token;
    quality = video?.quality;

    //ค้นหาไฟล์ Storage
    const storage = await Storages.findOne({
      where: { id: video?.sv_id },
    });
    if (!storage) return res.json({ status: false, msg: "not_storage" });

    sv_ip = storage?.sv_ip;

    if (!file?.duration) {
      // ดึงข้อมูลไฟล์ จากเซิฟเวอร์
      const host_files = `http://${sv_ip}:8888/files/list?token=${token}&file=file_${quality}.mp4`;
      let data = await getRequest(host_files);
      data = JSON.parse(data);
      duration = Math.floor(data?.data?.video_data?.format?.duration) || 0;

      if (duration) {
        await Files.update(
          { duration: duration },
          {
            where: { slug: slug },
            silent: true,
          }
        );
      }
    } else {
      duration = file?.duration;
    }

    imgdir = path.join(global.dir, `public/${file_slug}/`);
    await fs.ensureDir(path.join(imgdir, `parts`));
    await fs.ensureDir(path.join(imgdir, `sprites`));

    IntervalPerImage = getOptimalInterval();
    totalImages = Math.floor(duration / IntervalPerImage);
    totalSpirits = Math.ceil(
      duration / IntervalPerImage / (rowCount * colCount)
    );
    const startTime = moment("00:00:00", "HH:mm:ss.SSS");
    const endTime = moment("00:00:00", "HH:mm:ss.SSS").add(
      IntervalPerImage,
      "seconds"
    );

    console.log(
      `${file_slug} image => ${totalImages} / sec => ${IntervalPerImage}`
    );
    // ดาวน์โหลดรูปภาพ
    let start_inv_image = 0;
    for (let inv = 0; inv <= totalImages; inv++) {
      await downloadThumbs(start_inv_image);
      start_inv_image += IntervalPerImage;
    }

    console.log(`${file_slug} Download done`);
    //update width & height
    await getThumbsSize();
    //set vtt file and image sprite
    let i_break = false;
    start_inv_image = 0;
    let thumbOutput = "WEBVTT\n\n";
    for (let k = 0; k < totalSpirits; k++) {
      let lineX = [];
      for (let i = 0; i < rowCount; i++) {
        let lineY = [];
        for (let j = 0; j < colCount; j++) {
          const currentImageCount = k * rowCount * colCount + i * colCount + j;
          if (currentImageCount >= totalImages) {
            i_break = true;
            break;
          }

          thumbOutput += `${startTime.format(
            "HH:mm:ss.SSS"
          )} --> ${endTime.format("HH:mm:ss.SSS")}\n`;
          thumbOutput += `${file_slug}-${k < 10 ? `0${k}` : k}.jpg#xywh=${
            j * width
          },${i * height},${width},${height}\n\n`;

          startTime.add(IntervalPerImage, "seconds");
          endTime.add(IntervalPerImage, "seconds");

          lineY.push(start_inv_image);
          start_inv_image += IntervalPerImage;
        }
        lineX.push(lineY);
        if (i_break) {
          break;
        }
      }
      table[k] = lineX;
      table_c[k] = lineX.length;
    }

    //create vtt files

    await fs.writeFileSync(path.join(imgdir, `${file_slug}.vtt`), thumbOutput);

    //create sprite X
    await spriteX();
    //create sprite Y
    await spriteY();
    await resizeJimp();

    // เช็ค files_thumbs
    const thumb = await FilesThumb.findOne({
      where: { slug: slug },
    });

    if (thumb) {
      return res.json({
        status: false,
        msg: `has_thumb`,
      });
    } else {
      await uploadImage();
      await uploadVtt();
      let gid = await getVttDrive();
      let data_create = {};
      data_create.slug = slug;
      data_create.type = "vtt";
      data_create.backup = gid;

      await FilesThumb.create(data_create);

      await Servers.update(
        { work: 0 },
        {
          where: {
            id: process?.sid,
          },
          silent: true,
        }
      );

      await Progress.destroy({ where: { slug: slug, type: "thumbnails" } });

      shell.exec(
        `sleep 2 && sudo rm -rf ${global.dir}/public/${slug} && sleep 2 && bash ${global.dir}/shell/run.sh`,
        { async: false, silent: false },
        function (data) {}
      );

      return res.json({
        status: true,
        msg: `vtt_created`,
      });
    }
  } catch (err) {
    console.error(err);
    return res.json({ status: false, msg: `err` });
  }
  // upload file to google
  async function gDriveUp(code_exec) {
    return new Promise(function (resolve, reject) {
      shell.exec(
        `sleep 2 && ${code_exec}`,
        { async: true, silent: false },
        function (data) {
          resolve(data);
        }
      );
    });
  }
  async function uploadImage() {
    console.log(`${file_slug} Upload image`);
    for (const images of linksY) {
      let file_image = path.join(imgdir, `${file_slug}-${images}`);
      let status_image = path.join(imgdir, `${images}.txt`);
      await gDriveUp(
        `sudo -u root gdrive upload --parent ${g_folder} ${file_image} >> ${status_image} 2>&1`
      );
    }
    return true;
  }
  async function uploadVtt() {
    console.log(`${file_slug} Upload Vtt`);
    let file_vtt = path.join(imgdir, `${file_slug}.vtt`);
    let status_vtt = path.join(imgdir, `vtt-upload.txt`);
    return await gDriveUp(
      `sudo -u root gdrive upload --parent ${g_folder} ${file_vtt} >> ${status_vtt} 2>&1`
    );
  }
  async function getVttDrive() {
    await timeSleep(3);

    let status_vtt = path.join(imgdir, `vtt-upload.txt`);
    let matchGid = /Uploaded ([\w\-]{28,}) at/i;
    const f_read = fs.readFileSync(status_vtt, "utf8");

    if (!matchGid.test(f_read)) {
      return false;
    }
    const match = f_read.match(matchGid);

    if (!match[1]) {
      return false;
    } else {
      return match[1];
    }
  }

  async function getThumbsSize() {
    let file_parts = path.join(imgdir, `parts/0.jpg`);
    const dimensions = sizeOf(file_parts);
    return new Promise(function (resolve, reject) {
      width = dimensions?.width;
      height = dimensions?.height;
      resolve(true);
    });
  }
  async function downloadThumbs(sec) {
    let times = sec * 1000;
    let host = `http://${sv_ip}:8889/thumb/${token}/file_${quality}.mp4/thumb-${times}-w${width}.jpg`;
    let file_parts = path.join(imgdir, `parts/${sec}.jpg`);
    return new Promise(function (resolve, reject) {
      if (fs.existsSync(file_parts)) {
        //file exists
        resolve(true);
      } else {
        http.get(host, function (resp) {
          var buffers = [];
          var length = 0;
          resp.on("data", function (chunk) {
            // store each block of data
            length += chunk.length;
            buffers.push(chunk);
          });
          resp.on("end", function () {
            var content = Buffer.concat(buffers);
            if (content != "null" || content != null || content != "") {
              fs.writeFileSync(file_parts, content, "utf8");
              resolve(content);
            } else {
              getThumbs(sec);
            }
          });
        });
      }
    });
  }
  async function spriteX() {
    let sprite_row = 0,
      sprite_col = 0;
    for (const items of table) {
      sprite_col = 0;
      let linkX = [];
      for (const item of items) {
        if (item.length < colCount) {
          let count_add = colCount - item.length;
          for (let index = 0; index < count_add; index++) {
            item.push(0);
          }
        }
        let linksx = await createX(item, sprite_row, sprite_col);
        linkX.push(linksx);
        sprite_col++;
      }
      sprite_row++;
      links.push(linkX);
    }
    return links;
  }
  async function spriteY() {
    let i = 0;
    for (const link of links) {
      let out = await createY(link, i);
      linksY.push(out);
      i++;
    }
    return linksY;
  }

  async function resizeJimp() {
    for (const images of linksY) {
      let input = path.join(imgdir, `${images}`);
      let output = path.join(imgdir, `${file_slug}-${images}`);
      Jimp.read(input, (err, image) => {
        if (err) throw err;
        image
          .quality(60) // set JPEG quality
          .write(output); // save
      });
    }
    return linksY;
  }
  async function createX(items, sprite_row, sprite_col) {
    //console.log(item);
    let arrayimage = [];
    const outX = path.join(imgdir, `sprites/X_${sprite_row}_${sprite_col}.jpg`);

    return new Promise(function (resolve, reject) {
      items.map((img) => {
        arrayimage.push(path.join(imgdir, `parts/${img}.jpg`));
      });
      mergeImg(arrayimage, { direction: false }).then((img) => {
        img.write(outX, () => resolve(outX));
      });
    });
  }
  async function createY(items, n) {
    let output = path.join(imgdir, `${n < 10 ? `0${n}` : n}.jpg`);

    return new Promise(function (resolve, reject) {
      mergeImg(items, { direction: true }).then((img) => {
        img.write(output, () => {
          resolve(`${n < 10 ? `0${n}` : n}.jpg`);
        });
      });
    });
  }
  function getOptimalInterval() {
    if (duration < 120) return 1;
    if (duration < 300) return 2;
    if (duration < 600) return 3;
    if (duration < 1800) return 4;
    if (duration < 3600) return 5;
    if (duration < 7200) return 10;
    return 10;
  }

  async function getRequest(url) {
    return new Promise(function (resolve, reject) {
      if (!url) resolve(false);
      http.get(url, function (resp) {
        if (resp?.statusCode != 200) {
          resolve(false);
        } else {
          const buffers = [];
          let length = 0;
          resp.on("data", function (chunk) {
            // store each block of data
            length += chunk.length;
            buffers.push(chunk);
          });
          resp.on("end", function () {
            const content = Buffer.concat(buffers);
            const buf = Buffer.from(content);

            resolve(buf.toString());
          });
        }
      });
    });
  }
  async function timeSleep(sec) {
    if (!sec) {
      sec = Math.floor(Math.random() * 10);
    }
    return new Promise((rs) => setTimeout(rs, sec * 1000));
  }
};
