"use strict";
const express = require("express");
const router = express.Router();
const moment = require("moment");

router.all("/", (req, res) => res.status(404).end());

router.get("/run", require("./controllers/run"));
router.get("/start", require("./controllers/start"));
router.get("/gen/img", require("./controllers/gen.image"));
router.all("/active", (req, res) => res.status(200).json({ status: true }));

router.all("*", function (req, res) {
  res
    .status(404)
    .json({ status: false, msg: "page not found", date: moment().format() });
});
module.exports = router;
