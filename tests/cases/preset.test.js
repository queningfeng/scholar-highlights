/*!
 * The shipped preset for the author's own profile.
 *
 * Why this file exists: an earlier revision guessed the equal-contribution list
 * and got it wrong -- it marked the MICCAI paper (a sole first-author paper) and
 * the hydrogel review (a genuine second-author paper) as co-first, and missed
 * four papers that really are co-first. Google Scholar strips the `*` / `†`
 * markers, so without a correct preset those papers silently lose their role.
 *
 * This test pins the list to the author's own answer so it cannot drift again.
 */

"use strict";

const SH = require("../../src/content.js");
const harness = require("../harness.js");

const { describe, test, equal, deepEqual, ok } = harness;

const PROFILE = SH.KNOWN_PROFILES.ZxrkoP4AAAAJ;

/** Scholar strips the markers, so these bylines deliberately carry none. */
const COFIRST_PAPERS = [
  [
    "CoInS-Net: A Continuous Position-Aware Network for Joint Medical Image Interpolation and Segmentation",
    "Yujia Sun, Ningfeng Que, Peiting Shi, Rongrong Fu, Yingying Yang, Xinhang Li, Yin Dai",
  ],
  [
    "StateXDiff: Cell State-Contextualized Multimodal Diffusion for Single-Cell Perturbation Prediction",
    "Peiting Shi, Ningfeng Que, Xianzhe Huang, Xiaofei Wang, Jianzhong Jeff Xi",
  ],
  [
    "MLAR-UNet: LDCT image denoising based on U-Net with multiple lightweight attention-based modules and residual reinforcement",
    "Hao Tang, Ningfeng Que, Yanwen Tian, Mingzhe Li, Alessandro Perelli, Yueyang Teng",
  ],
  [
    "VTCNet: A Feature Fusion DL Model Based on CNN and ViT for the Classification of Cervical Cells",
    "Mingzhe Li, Ningfeng Que, Juanhua Zhang, Pingfang Du, Yin Dai",
  ],
  [
    "Coordinated Enhancement of Molecular and Spatial Fidelity for Biological Inference in Spatial Transcriptomics",
    "Xiao-Fei Wang, Ningfeng Que, Hanyu Liu, Chen-Yang Tao, Yu Jiang, Chao Li",
  ],
  [
    // The same paper under its earlier title; a profile may still show this one.
    "A Foundational Generative Model for Cross-platform Unified Enhancement of Spatial Transcriptomics",
    "Xiao-Fei Wang, Ningfeng Que, Hanyu Liu, Chen-Yang Tao, Yu Jiang, Chao Li",
  ],
];

/** Papers that must NOT be promoted to co-first. */
const NOT_COFIRST_PAPERS = [
  [
    "Adaptive Spatial Transcriptomics Interpolation via Cross-modal Cross-slice Modeling",
    "Ningfeng Que, Xiaofei Wang, Jingjing Chen, Yixuan Jiang, Chao Li",
    ["first"],
  ],
  [
    "Advances in Hydrogel-Based Electronic Skins: From Material Design to Multifunctional Applications",
    "Deliang Li, Ningfeng Que, Hao Tang, Yanwen Tian, Chenxi Jing, Le Liu, Ye Tian",
    ["second"],
  ],
];

function classify(title, byline, overrides) {
  return SH.classifyPaper({
    title,
    authors: byline,
    profileName: PROFILE.matchNames[0],
    aliases: PROFILE.aliases,
    overrides: overrides === undefined ? SH.normalizeOverrideMap(PROFILE.presetOverrides) : overrides,
  });
}

describe("shipped preset for ZxrkoP4AAAAJ");

test("the preset keys are already normalised", () => {
  for (const key of Object.keys(PROFILE.presetOverrides)) {
    equal(SH.normalizeTitle(key), key, `key ${key.slice(0, 40)}`);
  }
});

test("the preset covers exactly the five confirmed co-first papers", () => {
  const confirmed = [
    "coins net a continuous position aware network for joint medical image interpolation and segmentation",
    "statexdiff cell state contextualized multimodal diffusion for single cell perturbation prediction",
    "mlar unet ldct image denoising based on u net with multiple lightweight attention based modules and residual reinforcement",
    "vtcnet a feature fusion dl model based on cnn and vit for the classification of cervical cells",
    // FOCUS, under both of its titles.
    "coordinated enhancement of molecular and spatial fidelity for biological inference in spatial transcriptomics",
    "a foundational generative model for cross platform unified enhancement of spatial transcriptomics",
  ].sort();
  deepEqual(Object.keys(PROFILE.presetOverrides).sort(), confirmed);
});

test("no preset entry marks the sole first-author or the genuine second-author paper", () => {
  const keys = Object.keys(PROFILE.presetOverrides);
  const forbidden = [
    "adaptive spatial transcriptomics interpolation via cross modal cross slice modeling",
    "advances in hydrogel based electronic skins from material design to multifunctional applications",
  ];
  for (const key of forbidden) {
    ok(!keys.includes(key), `preset must not contain ${key.slice(0, 40)}`);
  }
});

for (const [title, byline] of COFIRST_PAPERS) {
  test(`the preset restores co-first for ${title.slice(0, 44)}`, () => {
    const withPreset = classify(title, byline);
    deepEqual(SH.activeRoleKeys(withPreset.roles), ["cofirst"], "with the preset");
    equal(withPreset.override, true, "preset override applied");
    // And without it the row really would be misread -- this is the bug the
    // preset exists to paper over.
    const withoutPreset = classify(title, byline, {});
    ok(
      !SH.activeRoleKeys(withoutPreset.roles).includes("cofirst"),
      "detection alone cannot see the stripped marker",
    );
  });
}

for (const [title, byline, expectedRoles] of NOT_COFIRST_PAPERS) {
  test(`the preset leaves ${title.slice(0, 40)} at its true position`, () => {
    const result = classify(title, byline);
    deepEqual(SH.activeRoleKeys(result.roles), expectedRoles);
    ok(!result.override, "no override applied");
  });
}
