package com.blue.whale.web.valid.validator;

import cn.hutool.core.io.FileUtil;
import cn.hutool.core.io.IoUtil;
import cn.hutool.core.util.ArrayUtil;
import com.blue.whale.global.i18n.I18N;
import com.blue.whale.web.valid.annotation.File;
import com.blue.whale.web.valid.enums.FileFormat;
import lombok.Getter;
import lombok.Setter;
import lombok.SneakyThrows;
import lombok.experimental.Accessors;
import org.springframework.web.multipart.MultipartFile;

import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.Arrays;

/**
 * FileValidator
 *
 * @author: Jiyeon2__
 * date: 2024/8/16
 * description: 校验器只有在真正使用的时候才会被实例化,不需要自己加实例化注解
 */
public class FileValidator implements ConstraintValidator<File, Object> {

    private File valid;


    @Override
    public void initialize(File constraintAnnotation) {
        this.valid = constraintAnnotation;
    }

    private void validMessage(String message, ConstraintValidatorContext cvc) {
        cvc.disableDefaultConstraintViolation();
        cvc.buildConstraintViolationWithTemplate(message)
                .addConstraintViolation();
    }

    @Override
    public boolean isValid(Object objectFile, ConstraintValidatorContext cvc) {
        if (objectFile == null) {
            return true;
        }
        //可迭代的文件
        if (iterableFileValid(objectFile, cvc)) {
            return true;
        }
        //单个文件
        return validFile(objectFile, cvc);
    }

    /**
     * 可迭代的文件 校验
     *
     * @param objectFile 文件object
     * @param cvc        校验上下文
     * @return 是否校验通过
     */
    private boolean iterableFileValid(Object objectFile, ConstraintValidatorContext cvc) {
        Iterable<?> iterable = null;
        if (objectFile.getClass().isArray()) {
            iterable = Arrays.asList((Object[]) objectFile);
        }
        if (objectFile instanceof Iterable<?>) {
            iterable = (Iterable<?>) objectFile;
        }
        if (iterable != null) {
            for (Object o : iterable) {
                if (!validFile(o, cvc)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * 单个文件校验
     *
     * @param unknown 文件
     * @param cvc     校验上下文
     * @return 是否校验通过
     */
    private boolean validFile(Object unknown, ConstraintValidatorContext cvc) {
        validParam validParam = fileParam(unknown);
        if (validParam == null) {
            validMessage(I18N.msg("web.file.data.error"), cvc);
            return false;
        }
        //校验文件大小
        if (!valid.allowEmpty() && validParam.getFileSize() == 0) {
            validMessage(I18N.msg("web.file.empty"), cvc);
            return false;
        }
        if (validParam.getFileSize() > valid.maxSize() * valid.unit().getSize()) {
            validMessage(I18N.msg("web.file.too.large"), cvc);
            return false;
        }
        //校验文件格式
        FileFormat[] formats = valid.formats();
        if (ArrayUtil.isEmpty(formats)) {
            return true;
        }
        for (FileFormat format : formats) {
            if (
                    !validParam.getFormatCode().startsWith(format.getCode()) ||
                            !validParam.getFormat().equalsIgnoreCase(format.getFormat())
            ) {
                validMessage(I18N.msg("web.file.format.error"), cvc);
                return false;
            }
        }
        return true;
    }


    @SneakyThrows
    private validParam fileParam(Object unknown) {
        if (unknown instanceof java.io.File file) {
            try (InputStream inputStream = new FileInputStream(file)) {
                validParam validParam = new validParam();
                validParam.setFormat(FileUtil.extName(file.getName()));
                validParam.setFileSize(file.length());
                validParam.setFormatCode(IoUtil.readHex64Upper(inputStream));
                return validParam;
            }
        }

        if (unknown instanceof MultipartFile file) {
            validParam validParam = new validParam();
            validParam.setFormat(FileUtil.extName(file.getOriginalFilename()));
            validParam.setFileSize(file.getSize());
            validParam.setFormatCode(IoUtil.readHex64Upper(file.getInputStream()));
            return validParam;
        }
        return null;
    }


    @Getter
    @Setter
    @Accessors(chain = true)
    public static class validParam {
        /**
         * 文件名
         */
        private String format;

        /**
         * 文件头
         */
        private String formatCode;

        /**
         * 文件大小 单位字节
         */
        private Long fileSize;


    }
}
