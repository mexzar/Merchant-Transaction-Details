// Small stand-ins for the pages Amazon shows instead of the one asked for.
export const SIGN_IN = `<!DOCTYPE html><html><head><title>Amazon Sign-In</title></head>
<body><form name="signIn" method="post" action="https://www.amazon.com/ap/signin"><input name="email" /></form></body></html>`;

export const CAPTCHA = `<!DOCTYPE html><html><head><title>Amazon.com</title></head>
<body><form method="get" action="/errors/validateCaptcha"><input id="captchacharacters" name="field-keywords" /></form></body></html>`;

export const WAF = `<!DOCTYPE html><html><head><title></title>
<script>window.awsWafCookieDomainList = []; AwsWafIntegration.saveReferrer();</script></head><body></body></html>`;

export const SORRY = `<!DOCTYPE html><html><head><title>Sorry! Something went wrong!</title></head><body></body></html>`;
