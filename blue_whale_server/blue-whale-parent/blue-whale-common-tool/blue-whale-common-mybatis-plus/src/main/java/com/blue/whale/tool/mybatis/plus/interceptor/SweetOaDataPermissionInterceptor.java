package com.blue.whale.tool.mybatis.plus.interceptor;


import com.baomidou.mybatisplus.core.toolkit.PluginUtils;
import com.baomidou.mybatisplus.extension.parser.JsqlParserSupport;
import com.baomidou.mybatisplus.extension.plugins.inner.InnerInterceptor;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.security.model.bean.SecureUser;
import com.blue.whale.security.resource.helper.ISecurity;
import com.blue.whale.tool.mybatis.plus.annotation.SweetOaDataPermission;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.expression.Alias;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.LongValue;
import net.sf.jsqlparser.expression.operators.conditional.AndExpression;
import net.sf.jsqlparser.expression.operators.relational.*;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.schema.Table;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.delete.Delete;
import net.sf.jsqlparser.statement.insert.Insert;
import net.sf.jsqlparser.statement.select.PlainSelect;
import net.sf.jsqlparser.statement.select.Select;
import net.sf.jsqlparser.statement.select.SelectBody;
import net.sf.jsqlparser.statement.select.SetOperationList;
import net.sf.jsqlparser.statement.update.Update;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.mapping.SqlCommandType;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;

import java.lang.reflect.Method;
import java.sql.SQLException;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * SweetOaDataPermissionHandler
 *
 * @author: Jiyeon2__
 * date: 2025/4/2
 * description: 数据权限拦截器
 */
public class SweetOaDataPermissionInterceptor extends JsqlParserSupport implements InnerInterceptor {

    @Override
    public void beforeQuery(Executor executor, MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) throws SQLException {
        try {
            PluginUtils.MPBoundSql mpBs = PluginUtils.mpBoundSql(boundSql);
            String sql = mpBs.sql();
            Statement statement = CCJSqlParserUtil.parse(mpBs.sql());
            if (statement instanceof Select) {
                this.processSelect((Select) statement, 0, sql, ms.getId());
            }
            sql = statement.toString();
            mpBs.sql(sql);
        } catch (JSQLParserException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    protected void processSelect(Select select, int index, String sql, Object obj) {
        SelectBody selectBody = select.getSelectBody();
        if (selectBody instanceof PlainSelect) {
            this.setWhere((PlainSelect) selectBody, (String) obj);
        } else if (selectBody instanceof SetOperationList) {
            SetOperationList setOperationList = (SetOperationList) selectBody;
            List<SelectBody> selectBodyList = setOperationList.getSelects();
            selectBodyList.forEach(s -> this.setWhere((PlainSelect) s, (String) obj));
        }
    }

    private void setWhere(PlainSelect plainSelect, String whereSegment) {
        Expression sqlSegment = this.getSqlSegment(plainSelect, whereSegment);
        if (null != sqlSegment) {
            plainSelect.setWhere(sqlSegment);
        }
    }

    public Expression getSqlSegment(PlainSelect plainSelect, String whereSegment) {
        Expression where = plainSelect.getWhere();
        //获取mapper名称
        String className = whereSegment.substring(0, whereSegment.lastIndexOf("."));
        //获取方法名
        String methodName = whereSegment.substring(whereSegment.lastIndexOf(".") + 1);
        Table fromItem = (Table) plainSelect.getFromItem();
        // 有别名用别名，无别名用表名，防止字段冲突报错
        Alias fromItemAlias = fromItem.getAlias();
        String mainTableName = fromItemAlias == null ? fromItem.getName() : fromItemAlias.getName();
        //获取当前mapper 的方法
        Method[] methods;
        try {
            methods = Class.forName(className).getMethods();
        } catch (ClassNotFoundException e) {
            throw SystemCode.FAILURE.exception();
        }
        for (Method method : methods) {
            if (Objects.equals(method.getName(), methodName)) {
                SweetOaDataPermission annotation = method.getAnnotation(SweetOaDataPermission.class);
                if (Objects.isNull(annotation)) {
                    return where;
                }
                SecureUser secureUser = ISecurity.secureUser();
                if (secureUser.getRoleValue() == 2) {
                    EqualsTo companyEqualsTo = new EqualsTo();
                    companyEqualsTo.setLeftExpression(new Column(mainTableName + ".company_id"));
                    companyEqualsTo.setRightExpression(new LongValue(secureUser.getCompanyId()));
                    return new AndExpression(where, companyEqualsTo);
                } else if (secureUser.getRoleValue() == 3) {
                    InExpression deptIn = new InExpression();
                    deptIn.setLeftExpression(new Column(mainTableName + ".dept_id"));
                    deptIn.setRightItemsList(
                            new ExpressionList(
                                    secureUser
                                            .getDepartments()
                                            .stream()
                                            .map(LongValue::new)
                                            .collect(Collectors.toList()))
                    );
                    return new AndExpression(where, deptIn);
                } else if (secureUser.getRoleValue() == 4) {
                    EqualsTo userEqualsTo = new EqualsTo();
                    userEqualsTo.setLeftExpression(new Column(mainTableName + (Objects.equals("u", mainTableName) ? ".id" : ".user_id")));
                    userEqualsTo.setRightExpression(new LongValue(secureUser.getId()));
                    return new AndExpression(where, userEqualsTo);
                }
            }
        }
        return where;
    }
}