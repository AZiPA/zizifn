# Serverless Runtime

> [!NOTE]
> 
>  [● توضیحات به زبان فارسی][fa]
>
>  [● توضیحات به زبان انگلیسی][en]
>
> <br><br/>
> 
> <br><br/>

<br><br/>	




## Setup

After forking this repository, you need to create a few GitHub repository secrets before running the workflow.

Go to:

**Repository → Settings → Secrets and variables → Actions**

Then click **New repository secret** and add the following variables.

| Secret Name | Required | Default | Description |
|-------------|:--------:|---------|-------------|
| `CLOUDFLARE_API_TOKEN` | ✔️Yes | - | Your Cloudflare API Token. It **must** have permission to **Edit Workers**. |
| `CLOUDFLARE_ACCOUNT_ID` | ✔️Yes | - | Your Cloudflare Account ID. |
| `UUID` | Required | - | Your own [version4 UUID][1]. Must be set for client authentication. |
| `PROXYIP` | Optional | - | Optional comma-separated proxy IPs or hostnames (e.g. `proxy1.example.com:443,proxy2.example.com:443`). |

## Required Cloudflare Information

The following two secrets are **required** and must be obtained from your own Cloudflare account:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

> **Note**
>
> The API Token must include permission to **Edit Workers**. Otherwise, the deployment workflow will fail.

Once these secrets have been added, the GitHub Actions workflow is ready to deploy.

[1]: https://www.uuidgenerator.net
[fa]: https://diana-cl.github.io/Diana-Cl/topics/zizifn
[en]: https://diana-cl.github.io/Diana-Cl/en/topics/zizifn
