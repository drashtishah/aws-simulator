Pollen Systems, 2:15 PM Thursday. You are on-call for a 17-person document management startup whose paralegals upload contracts and case files through the web app all day.

A Slack message lands in #frontend: "Upload is broken in the app. Tested the same URL in Postman and it works fine."

The support queue shows three law firm customers open tickets in the last twenty minutes. Uploads are the core of the product.

Frontend developer Rina is in the thread. She has confirmed the presigned URL is valid and the backend is generating it successfully. The browser shows nothing useful, just a red line in the Network tab and no error message in the UI.

The S3 bucket is `pollen-docs-prod`. The API endpoint is `api.pollen.io`. The frontend runs at `app.pollen.io`.

Where do you start?
