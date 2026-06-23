# Cloth Try-On Studio

Next.js 自用 AI 衣橱/试穿原型。

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

复制 `.env.example` 为 `.env.local`，至少填写一个 provider 的 key：

```bash
cp .env.example .env.local
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

## 当前版本

- 使用 IndexedDB 保存图片和 metadata，不再把大图塞进 `localStorage`
- 上传衣服、鞋、配饰
- 编辑单品名称、类别、标签
- 上传本人参考照
- 选择单品并生成本地预览稿
- 衣橱单品支持编辑、删除、单张 AI 识别和当前筛选结果批量识别
- 衣橱单品支持左右 90 度旋转；旋转会保留原 asset id，并清除旧 cutout，避免方向不一致
- 衣橱单品支持本地 Remove BG，生成透明 PNG cutout，保留原图，不消耗 Gemini/OpenAI API
- 历史结果支持大图预览、收藏、下载、删除和复用搭配
- 历史结果会保存生成调试信息，包括用户 prompt、后端完整 prompt、provider、模型和单品输入摘要
- 支持导出/导入本地 IndexedDB 备份 JSON
- 支持生成前确认，展示 provider、模型、使用原图/抠图和本次单品
- 设置页可切换是否生成前确认、Gemini/OpenAI 图片模型名；生成默认使用原图，也可手动开启优先使用抠图
- 默认调用 Next.js 后端 `/api/generate`
- 支持 `/api/analyze-item` 自动识别单品名称、类别和标签
- 支持 Gemini 和 OpenAI provider
- 也可在设置里填写 Lambda/API Gateway endpoint，把生成请求转发给 AWS

## Gemini 模型和配额

`gemini-3.5-flash` 不是当前官方文档里的图片生成模型名，也不适合这个试穿生成接口。

图片生成可先用：

```env
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
```

如果你的 Google AI 项目有权限和额度，也可以试：

```env
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
```

如果报 `quota exceeded` 且提示 free tier limit 为 `0`，说明该项目/地区/模型没有免费图片生成额度。处理方式是启用 Google AI billing、换有额度的项目，或在设置页把 provider 切到 OpenAI 并配置 `OPENAI_API_KEY`。

## Lambda 请求

```json
{
  "provider": "gemini",
  "occasion": "周末休闲",
  "prompt": "生成要求文本",
  "modelImage": "data:image/jpeg;base64,...",
  "items": [
    {
      "id": "...",
      "name": "White Shirt",
      "category": "top",
      "tags": ["white", "casual"],
      "image": "data:image/jpeg;base64,..."
    }
  ]
}
```

预期响应：

```json
{
  "imageUrl": "https://...",
  "notes": "optional"
}
```
