"use strict";

const path = require("path");
const fs = require("fs");
const Files = require("../modules/Mysql/Files");
const Servers = require("../modules/Mysql/Servers");
const Progress = require("../modules/Mysql/Progress");
const FilesVideo = require("../modules/Mysql/Files");
const FilesThumb = require("../modules/Mysql/FilesThumb");
const { Sequelize, Op } = require("sequelize");
const shell = require("shelljs");
const { SettingValue, GenerateID } = require("../modules/Function");

module.exports = async (req, res) => {
  const { sv_ip, slug } = req.query;
  try {
    if (!sv_ip) return res.json({ status: false });
    let where = {},
      notslug = [];
    //server
    let { domain_thumbnails } = await SettingValue(true);

    if (!domain_thumbnails) {
      return res.json({ status: false, msg: "not_domain_thumbnails" });
    }
    const server = await Servers.findOne({
      raw: true,
      attributes: ["id"],
      where: {
        active: 1,
        work: 0,
        type: "thumbnails",
        sv_ip: sv_ip,
      },
    });
    if (!server) return res.json({ status: false, msg: "not_server" });
    // thumbs
    const thumbs = await FilesThumb.findAll({
      raw: true,
      attributes: ["slug"],
    });
    if (thumbs.length) {
      thumbs.forEach((el, index) => {
        if (!notslug.includes(el?.slug)) {
          notslug.push(el?.slug);
        }
      });
    }
    // process
    const process = await Progress.findAll({
      raw: true,
      attributes: ["slug"],
      where: {
        type: "thumbnails",
        quality: "vtt",
      },
    });
    if (process.length) {
      process.forEach((el, index) => {
        if (!notslug.includes(el?.slug)) {
          notslug.push(el?.slug);
        }
      });
    }
    //เช็คไฟล์
    where.status = { [Op.or]: [3, 5] };
    where.e_code = 0;
    where.active = 1;
    if (notslug.length) {
      where.slug = { [Op.notIn]: notslug };
    }
    const files = await Files.findOne({
      raw: true,
      attributes: ["uid", "id", "slug"],
      where: {
        ...where,
        ...[
          Sequelize.literal(
            `slug IN ( SELECT slug FROM files_videos WHERE sv_id != 0 GROUP BY slug HAVING COUNT( * ) > 0 )`
          ),
        ],
      },
      order: [["createdAt", "DESC"]],
    });

    if (!files) {
      return res.json({ status: false, msg: "not_file" });
    } else {
      //insert convert
      let data_create = {};
      data_create.uid = files?.uid;
      data_create.fid = files?.id;
      data_create.slug = files?.slug;
      data_create.type = "thumbnails";
      data_create.quality = "vtt";
      data_create.sid = server?.id;
      await Progress.create(data_create);
      //อัพเดต server

      await Servers.update(
        { work: 1 },
        {
          where: {
            id: server?.id,
          },
          silent: true,
        }
      );
      shell.exec(
        `sleep 2 && curl -sS "http://127.0.0.1:8887/gen/img?slug=${files?.slug}"`,
        { async: false, silent: false },
        function (data) {}
      );

      return res.json({ status: true, msg: files?.slug });
    }
  } catch (error) {
    console.log(error);
    return res.json({ status: false, msg: error.name });
  }
};
