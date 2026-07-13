package com.blue.whale.web.utils;

import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;

import java.util.HashMap;
import java.util.Map;


@Slf4j
public class MessageUtils {

    private static final String fsRobot = "https://open.feishu.cn/open-apis/bot/v2/hook/2f5f5c9e-0d2d-4444-bfc9-a240d4de3865";
    public static final String FS_INVOICE_AUTH_CHECK_ROBOT = "https://open.feishu.cn/open-apis/bot/v2/hook/d04c537d-3720-4f5d-873e-dc90714ff678";
    public static final String FS_RECHARGE_NOTIFY_ROBOT = "https://open.feishu.cn/open-apis/bot/v2/hook/8fc5ae02-d599-466e-a900-73d008b4cca1";

    public static void feishuMessage(String message, String msgType, String robot) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json;charset=utf-8");
        JSONObject text = new JSONObject();
        text.put("text", message);
        JSONObject params = new JSONObject();
        params.put("msg_type", StrUtil.isBlank(msgType) ? "text" : msgType);
        params.put("content", text);
        try {
            String body = OkHttpUtils.postBody(StrUtil.isBlank(robot) ? fsRobot : robot, headers, params.toJSONString(), 3);
            System.out.println(body);
        } catch (Exception e) {
            log.error("飞书消息推送失败 message ={} error_msg = {}", message, e.getMessage(), e);
        }
    }

//    public static void dingTalkMessage(String message, SendMessageBo sendMessageBo) {
//        JSONObject text = new JSONObject();
//        text.put("content", message);
//        JSONObject param = new JSONObject();
//        param.put("msgtype", "text");
//        param.put("text", text);
//        Long timestamp = System.currentTimeMillis();
//        String stringToSign = timestamp + "\n" + sendMessageBo.getSecret();
//        try {
//            Mac mac = Mac.getInstance("HmacSHA256");
//            mac.init(new SecretKeySpec(sendMessageBo.getSecret().getBytes("UTF-8"), "HmacSHA256"));
//            byte[] signData = mac.doFinal(stringToSign.getBytes("UTF-8"));
//            String sign = URLEncoder.encode(new String(Base64.encodeBase64(signData)), "UTF-8");
//            String body = Jsoup.connect(sendMessageBo.getUrl()).ignoreContentType(true)
//                    .data("access_token",sendMessageBo.getAccessToken())
//                    .data("timestamp",timestamp.toString())
//                    .data("sign",sign)
//                    .requestBody(param.toJSONString())
//                    .method(Connection.Method.POST)
//                    .header("Content-Type", "application/json;charset=utf-8")
//                    .execute().body();
//            System.out.println(body);
//        }catch (Exception e){
//            log.info("roi警报钉钉消息推送失败");
//            log.error(e.getMessage(), e);
//        }
//    }

    public static void main(String[] args) {
        String msg = "check";

        feishuMessage(msg, null, FS_INVOICE_AUTH_CHECK_ROBOT);
//        SendMessageBo dingTalkSendMessageBo = JSONObject.parseObject("{\"url\":\"https://oapi.dingtalk.com/robot/send\",\"accessToken\":\"aaa715ec24d4626a4d0ec0f01892d40175a3b955242a1af2f2931fe3b715aca3\",\"secret\":\"SECd3f6a6131d57e9ba5a2586ee7b0dcdd596c5fc8f3cfed328d2f6a2790b2c9daa\"}", SendMessageBo.class);
//        dingTalkMessage("测试数据",dingTalkSendMessageBo);
    }

}
